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

export function groupCommits(commits, options = {}) { return []; }
