import { distance } from "fastest-levenshtein";

/**
 * The core grouping engine.
 *
 * Scores every pair of commits across 2 dimensions then runs
 * a greedy union-find to build the final groups.
 *
 * Scoring dimensions (each 0–100, weighted):
 *   1. Message similarity      — Levenshtein on normalized commit messages (primary signal)
 *   2. File/directory overlap  — Jaccard on file sets + directory bonus (structural signal)
 *
 * Time proximity and branch origin are intentionally excluded — they group
 * commits that are coincidentally close rather than semantically related.
 */

const WEIGHTS = {
  message:   0.55,  // primary: most intentional signal a developer gives
  file:      0.30,  // structural: same files = likely same task
  directory: 0.15,  // weak structural: same area of codebase
};

// Common noise prefixes to strip before comparing messages
const NOISE_PREFIXES = /^(fix|feat|chore|wip|temp|update|add|remove|refactor|hotfix|patch|minor|tweak|misc|test|tests|style|docs|ci|build|revert)[:\s!]*/i;
const NOISE_WORDS = /\b(the|a|an|and|or|to|in|on|for|of|with|at|by)\b/gi;

/**
 * Normalize a commit message for comparison:
 * strips conventional commit prefixes and filler words.
 */
function normalizeMessage(msg) {
  return msg
    .toLowerCase()
    .replace(NOISE_PREFIXES, "")
    .replace(NOISE_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Levenshtein-based similarity score (0–100).
 */
function messageSimilarity(a, b) {
  const na = normalizeMessage(a);
  const nb = normalizeMessage(b);
  if (!na || !nb) return 0;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 100;
  const dist = distance(na, nb);
  return Math.round((1 - dist / maxLen) * 100);
}

/**
 * Jaccard similarity on two sets.
 */
function jaccardSimilarity(setA, setB) {
  if (!setA.length && !setB.length) return 0;
  const a = new Set(setA);
  const b = new Set(setB);
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : Math.round((intersection / union) * 100);
}


/**
 * Score a pair of commits across all dimensions.
 * Returns a weighted composite score (0–100).
 */
export function scorePair(commitA, commitB) {
  const msgScore  = messageSimilarity(commitA.message, commitB.message);
  const fileScore = jaccardSimilarity(commitA.files, commitB.files);
  const dirScore  = jaccardSimilarity(commitA.dirs, commitB.dirs);

  const composite = Math.round(
    msgScore  * WEIGHTS.message +
    fileScore * WEIGHTS.file +
    dirScore  * WEIGHTS.directory
  );

  return {
    composite,
    breakdown: { message: msgScore, file: fileScore, directory: dirScore },
  };
}

/**
 * Union-Find (disjoint set) for clustering.
 */
class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }
  find(x) {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(x, y) {
    const px = this.find(x), py = this.find(y);
    if (px === py) return;
    if (this.rank[px] < this.rank[py]) this.parent[px] = py;
    else if (this.rank[px] > this.rank[py]) this.parent[py] = px;
    else { this.parent[py] = px; this.rank[px]++; }
  }
}

/**
 * Main grouping function.
 *
 * @param {Array}  commits     - Structured commit objects from git.js
 * @param {Object} options
 * @param {number} options.threshold    - Min composite score to group (0–100)
 * @param {number} options.minGroup     - Min commits required to form a group
 *
 * @returns {Array} groups — each group has commits[], scores[], suggestedMessage
 */
export function groupCommits(commits, { threshold = 60, minGroup = 2 } = {}) {
  const n = commits.length;
  const uf = new UnionFind(n);
  const pairScores = new Map(); // "i,j" -> score object

  // Score every pair — O(n²) but n is capped at ~200 in practice
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const score = scorePair(commits[i], commits[j]);
      pairScores.set(`${i},${j}`, score);
      if (score.composite >= threshold) {
        uf.union(i, j);
      }
    }
  }

  // Build groups from union-find result
  const groupMap = new Map();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    if (!groupMap.has(root)) groupMap.set(root, []);
    groupMap.get(root).push(i);
  }

  const groups = [];
  for (const [, indices] of groupMap) {
    const groupCommits = indices.map((i) => commits[i]);

    // Solo commits (no group match) are kept as-is
    if (groupCommits.length < minGroup) {
      groups.push({
        type: "keep",
        commits: groupCommits,
        squashedMessage: groupCommits[0].message,
        avgScore: 0,
        reason: "No similar commits found",
      });
      continue;
    }

    // Compute avg score within the group
    let totalScore = 0, pairs = 0;
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        const key = `${Math.min(indices[a], indices[b])},${Math.max(indices[a], indices[b])}`;
        if (pairScores.has(key)) {
          totalScore += pairScores.get(key).composite;
          pairs++;
        }
      }
    }

    groups.push({
      type: "squash",
      commits: groupCommits,
      squashedMessage: suggestMessage(groupCommits),
      avgScore: pairs > 0 ? Math.round(totalScore / pairs) : 0,
      reason: describeReason(groupCommits),
    });
  }

  // Sort groups by first commit's chronological position
  return groups.sort((a, b) => b.commits[0].date - a.commits[0].date);
}

/**
 * Suggest a clean squash commit message from a group.
 * Picks the most "meaningful" message (longest after noise removal).
 */
function suggestMessage(commits) {
  const cleaned = commits.map((c) => ({
    original: c.message,
    normalized: normalizeMessage(c.message),
  }));
  const best = cleaned.reduce((a, b) =>
    b.normalized.length > a.normalized.length ? b : a
  );
  return best.original;
}

/**
 * Human-readable explanation of why commits were grouped.
 */
function describeReason(commits) {
  const reasons = [];
  const allFiles = commits.flatMap((c) => c.files);
  const allDirs  = commits.flatMap((c) => c.dirs);

  const uniqueFiles = new Set(allFiles);
  const uniqueDirs  = new Set(allDirs);

  // File signal
  if (uniqueFiles.size <= 3) {
    reasons.push(`same file(s): ${[...uniqueFiles].slice(0, 3).join(", ")}`);
  } else if (uniqueDirs.size <= 2) {
    reasons.push(`same directory: ${[...uniqueDirs].join(", ")}`);
  }

  // Message signal
  const msgs = commits.map((c) => normalizeMessage(c.message));
  const avgMsgSim = msgs.reduce((total, m, i) => {
    if (i === 0) return total;
    return total + messageSimilarity(m, msgs[i - 1]);
  }, 0) / Math.max(msgs.length - 1, 1);

  if (avgMsgSim > 65) reasons.push("similar commit messages");

  return reasons.length ? reasons.join(" · ") : "high composite similarity score";
}
