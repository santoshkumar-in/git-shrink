import { distance } from "fastest-levenshtein";

/**
 * The core grouping engine.
 *
 * KEY INVARIANT: groups must be contiguous runs in the commit list.
 * A group of commits at positions [3,7,12] is meaningless for a rebase —
 * you can only squash commits that sit next to each other in history.
 *
 * Algorithm:
 *   1. Score every adjacent pair (i, i+1) in the commit list.
 *   2. Extend runs greedily: if pair (i, i+1) scores above threshold,
 *      keep extending while consecutive commits stay related.
 *   3. A group is only formed when the run is >= minGroup commits long.
 *
 * This replaces the previous union-find approach which had no position
 * awareness and merged non-adjacent commits into the same group.
 */

const WEIGHTS = {
  message:   0.55,
  file:      0.30,
  directory: 0.15,
};

const NOISE_PREFIXES = /^(fix|feat|chore|wip|temp|update|add|remove|refactor|hotfix|patch|minor|tweak|misc|test|tests|style|docs|ci|build|revert)[:\s!]*/i;
const NOISE_WORDS = /\b(the|a|an|and|or|to|in|on|for|of|with|at|by)\b/gi;

function normalizeMessage(msg) {
  return msg
    .toLowerCase()
    .replace(NOISE_PREFIXES, "")
    .replace(NOISE_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function messageSimilarity(a, b) {
  const na = normalizeMessage(a);
  const nb = normalizeMessage(b);

  if (!na && !nb) {
    const ra = a.toLowerCase().trim();
    const rb = b.toLowerCase().trim();
    if (!ra || !rb) return 0;
    const maxLen = Math.max(ra.length, rb.length);
    return Math.round((1 - distance(ra, rb) / maxLen) * 100);
  }
  if (!na || !nb) {
    const ra = a.toLowerCase().trim();
    const rb = b.toLowerCase().trim();
    const maxLen = Math.max(ra.length, rb.length);
    return Math.round((1 - distance(ra, rb) / maxLen) * 100);
  }
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 100;
  return Math.round((1 - distance(na, nb) / maxLen) * 100);
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
  const fileScore = jaccardSimilarity(commitA.files, commitB.files);
  const dirScore  = jaccardSimilarity(commitA.dirs,  commitB.dirs);
  const composite = Math.round(
    msgScore  * WEIGHTS.message +
    fileScore * WEIGHTS.file +
    dirScore  * WEIGHTS.directory
  );
  return { composite, breakdown: { message: msgScore, file: fileScore, directory: dirScore } };
}

/**
 * Main grouping function — contiguous-run algorithm.
 *
 * Commits arrive newest-first from git log. We reverse to oldest-first
 * so we can walk chronologically and build runs in history order.
 */
export function groupCommits(commits, { threshold = 50, minGroup = 2 } = {}) {
  if (!commits.length) return [];

  // Work oldest-first (git log returns newest-first)
  const ordered = [...commits].reverse();
  const n = ordered.length;

  // Score each adjacent pair
  const adjacentScores = [];
  for (let i = 0; i < n - 1; i++) {
    adjacentScores.push(scorePair(ordered[i], ordered[i + 1]));
  }

  // Build contiguous runs where every consecutive pair meets the threshold
  const groups = [];
  let i = 0;

  while (i < n) {
    // Try to extend a run starting at i
    let runEnd = i;
    while (
      runEnd < n - 1 &&
      adjacentScores[runEnd].composite >= threshold
    ) {
      runEnd++;
    }

    const runLength = runEnd - i + 1;

    if (runLength >= minGroup) {
      const runCommits = ordered.slice(i, runEnd + 1);

      // Avg score across pairs in this run
      let totalScore = 0;
      for (let k = i; k < runEnd; k++) totalScore += adjacentScores[k].composite;
      const avgScore = Math.round(totalScore / (runEnd - i));

      groups.push({
        type: "squash",
        commits: runCommits,           // oldest-first
        squashedMessage: suggestMessage(runCommits),
        avgScore,
        reason: describeReason(runCommits, adjacentScores.slice(i, runEnd)),
        // Store the positions for apply to use
        startIndex: i,
        endIndex: runEnd,
      });
      i = runEnd + 1;
    } else {
      // Solo commit — keep as-is
      groups.push({
        type: "keep",
        commits: [ordered[i]],
        squashedMessage: ordered[i].message,
        avgScore: 0,
        reason: "No similar adjacent commits",
        startIndex: i,
        endIndex: i,
      });
      i++;
    }
  }

  // Return newest-first to match the display convention (most recent groups first)
  return groups.reverse();
}

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

function describeReason(commits, pairScores) {
  const reasons = [];
  const allFiles = commits.flatMap((c) => c.files);
  const allDirs  = commits.flatMap((c) => c.dirs);
  const uniqueFiles = new Set(allFiles);
  const uniqueDirs  = new Set(allDirs);

  if (uniqueFiles.size <= 3) {
    reasons.push(`same file(s): ${[...uniqueFiles].slice(0, 3).join(", ")}`);
  } else if (uniqueDirs.size <= 2) {
    reasons.push(`same directory: ${[...uniqueDirs].join(", ")}`);
  }

  const msgs = commits.map((c) => normalizeMessage(c.message));
  const avgMsgSim = msgs.reduce((total, m, i) => {
    if (i === 0) return total;
    return total + messageSimilarity(m, msgs[i - 1]);
  }, 0) / Math.max(msgs.length - 1, 1);

  if (avgMsgSim > 65) reasons.push("similar commit messages");

  return reasons.length ? reasons.join(" · ") : "high composite similarity score";
}