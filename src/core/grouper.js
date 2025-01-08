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

export function groupCommits(commits, options = {}) { return []; }

