// Core grouping engine
// Plan:
//   1. score each pair of commits
//   2. group pairs above threshold
//   3. return groups with suggested squash message
//
// Scoring ideas:
//   - message similarity (levenshtein)
//   - same files touched
//   - same directories

export function scorePair(commitA, commitB) {
  // TODO
  return { composite: 0 };
}

export function groupCommits(commits, options = {}) {
  // TODO
  return [];
}
