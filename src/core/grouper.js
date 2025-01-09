import { distance } from 'fastest-levenshtein';

const NOISE_PREFIXES = /^(fix|feat|chore|wip|temp|update|add|remove|refactor|hotfix|patch|minor|tweak|misc|test|tests|style|docs|ci|build|revert)[:\s!]*/i;
const NOISE_WORDS = /\b(the|a|an|and|or|to|in|on|for|of|with|at|by)\b/gi;

function normalizeMessage(msg) {
  return msg
    .toLowerCase()
    .replace(NOISE_PREFIXES, '')
    .replace(NOISE_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function messageSimilarity(a, b) {
  const na = normalizeMessage(a);
  const nb = normalizeMessage(b);
  if (!na || !nb) return 0;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 100;
  const dist = distance(na, nb);
  return Math.round((1 - dist / maxLen) * 100);
}

function jaccardSimilarity(setA, setB) {
  if (!setA.length && !setB.length) return 0;
  const a = new Set(setA);
  const b = new Set(setB);
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : Math.round((intersection / union) * 100);
}

export function scorePair(commitA, commitB) {
  const msgScore  = messageSimilarity(commitA.message, commitB.message);
  const fileScore = jaccardSimilarity(commitA.files || [], commitB.files || []);
  const dirScore  = jaccardSimilarity(commitA.dirs  || [], commitB.dirs  || []);

  // weights - rough for now, will tune after testing
  const composite = Math.round(msgScore * 0.5 + fileScore * 0.35 + dirScore * 0.15);

  return { composite, breakdown: { message: msgScore, file: fileScore, directory: dirScore } };
}

export function groupCommits(commits, options = {}) {
  // TODO: actual grouping
  return [];
}


// --- grouping (naive first pass, will improve) ---

export function groupCommits(commits, { threshold = 60, minGroup = 2 } = {}) {
  const groups = [];
  const used = new Set();

  for (let i = 0; i < commits.length; i++) {
    if (used.has(i)) continue;
    const group = [commits[i]];
    used.add(i);

    for (let j = i + 1; j < commits.length; j++) {
      if (used.has(j)) continue;
      const score = scorePair(commits[i], commits[j]);
      if (score.composite >= threshold) {
        group.push(commits[j]);
        used.add(j);
      }
    }

    groups.push({
      type: group.length >= minGroup ? 'squash' : 'keep',
      commits: group,
      squashedMessage: group[0].message,
      avgScore: 0,
    });
  }

  return groups;
}
