import { distance } from 'fastest-levenshtein';

const NOISE_PREFIXES = /^(fix|feat|chore|wip|temp|update|add|remove|refactor|hotfix|patch|minor|tweak|misc|test|tests|style|docs|ci|build|revert)[:\s!]*/i;
const NOISE_WORDS = /\b(the|a|an|and|or|to|in|on|for|of|with|at|by)\b/gi;

function normalizeMessage(msg) {
  return msg.toLowerCase().replace(NOISE_PREFIXES, '').replace(NOISE_WORDS, ' ').replace(/\s+/g, ' ').trim();
}

function messageSimilarity(a, b) {
  const na = normalizeMessage(a); const nb = normalizeMessage(b);
  if (!na || !nb) return 0;
  const maxLen = Math.max(na.length, nb.length);
  return Math.round((1 - distance(na, nb) / maxLen) * 100);
}

export function scorePair(commitA, commitB) {
  return { composite: messageSimilarity(commitA.message, commitB.message), breakdown: {} };
}

function jaccardSimilarity(setA, setB) {
  if (!setA.length && !setB.length) return 0;
  const a = new Set(setA); const b = new Set(setB);
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : Math.round((intersection / union) * 100);
}

const WEIGHTS = { message: 0.50, file: 0.35, directory: 0.15 };

export function scorePair(commitA, commitB) {
  const msgScore  = messageSimilarity(commitA.message, commitB.message);
  const fileScore = jaccardSimilarity(commitA.files || [], commitB.files || []);
  const dirScore  = jaccardSimilarity(commitA.dirs  || [], commitB.dirs  || []);
  const composite = Math.round(msgScore * WEIGHTS.message + fileScore * WEIGHTS.file + dirScore * WEIGHTS.directory);
  return { composite, breakdown: { message: msgScore, file: fileScore, directory: dirScore } };
}

class UnionFind {
  constructor(n) { this.parent = Array.from({length: n}, (_, i) => i); this.rank = new Array(n).fill(0); }
  find(x) { if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]); return this.parent[x]; }
  union(x, y) { const px = this.find(x), py = this.find(y); if (px === py) return; if (this.rank[px] < this.rank[py]) this.parent[px] = py; else if (this.rank[px] > this.rank[py]) this.parent[py] = px; else { this.parent[py] = px; this.rank[px]++; } }
}

export function groupCommits(commits, { threshold = 60, minGroup = 2 } = {}) {
  const n = commits.length; const uf = new UnionFind(n);
  for (let i = 0; i < n; i++) for (let j = i+1; j < n; j++) {
    if (scorePair(commits[i], commits[j]).composite >= threshold) uf.union(i, j);
  }
  const groupMap = new Map();
  for (let i = 0; i < n; i++) { const root = uf.find(i); if (!groupMap.has(root)) groupMap.set(root, []); groupMap.get(root).push(i); }
  const groups = [];
  for (const [, indices] of groupMap) {
    const gc = indices.map((i) => commits[i]);
    const best = gc.reduce((a, b) => b.message.length > a.message.length ? b : a);
    const uniqueFiles = new Set(gc.flatMap(x => x.files || []));
    const reason = uniqueFiles.size <= 3 ? `same file(s): ${[...uniqueFiles].slice(0,3).join(', ')}` : 'similar commit messages';
    groups.push({ type: gc.length >= minGroup ? 'squash' : 'keep', commits: gc, squashedMessage: best.message, avgScore: 0, reason });
  }
  return groups.sort((a, b) => b.commits[0].date - a.commits[0].date);
}


