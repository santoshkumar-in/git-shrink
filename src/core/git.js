import simpleGit from "simple-git";
import path from "path";

/**
 * Fetches commits with full metadata needed for grouping analysis.
 * Returns structured commit objects including file change lists.
 */
export async function getCommits({ count, from, to, branch } = {}) {
  const git = simpleGit(process.cwd());

  // Validate this is a git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error("Not a git repository. Run git-shrink from within a git project.");
  }

  // Fetch log with stat info
  let log;
  if (from) {
    // Explicit hash range: from..to
    log = await git.log({ from, to: to || "HEAD", "--no-merges": null });
  } else if (branch && branch !== "HEAD") {
    // Branch mode: fetch the last N commits reachable from the named branch.
    // simple-git doesn't have a direct "log branch -n N" shorthand, so we
    // use raw args to get exactly `git log <branch> --max-count=N --no-merges`.
    const rawLog = await git.raw([
      "log",
      branch,
      `--max-count=${count || 50}`,
      "--no-merges",
      "--format=%H%x1f%an%x1f%ae%x1f%ai%x1f%s",
    ]);
    // Parse the raw output into the same shape simple-git's log() returns
    const rawCommits = rawLog.trim().split("\n").filter(Boolean).map((line) => {
      const [hash, author_name, author_email, date, ...msgParts] = line.split("\x1f");
      return { hash, author_name, author_email, date, message: msgParts.join(" ") };
    });
    log = { all: rawCommits };
  } else {
    // Default: last N commits from HEAD
    log = await git.log({
      "--max-count": String(count || 50),
      "--no-merges": null,
    });
  }

  if (!log.all.length) {
    throw new Error("No commits found in the specified range.");
  }

  // For each commit, fetch the actual changed files
  const commits = await Promise.all(
    log.all.map(async (c) => {
      let files = [];
      try {
        const diff = await git.diffSummary([`${c.hash}^`, c.hash]);
        files = diff.files.map((f) => f.file);
      } catch {
        // First commit has no parent — skip file diff
      }

      return {
        hash: c.hash,
        shortHash: c.hash.slice(0, 7),
        message: c.message.trim(),
        author: c.author_name,
        date: new Date(c.date),
        files,
        // Derived metadata
        dirs: [...new Set(files.map((f) => path.dirname(f)))],
        fileExts: [...new Set(files.map((f) => path.extname(f)).filter(Boolean))],
      };
    })
  );

  return commits;
}

/**
 * Returns the current branch name.
 */
export async function getCurrentBranch() {
  const git = simpleGit(process.cwd());
  const summary = await git.branchLocal();
  return summary.current;
}

/**
 * Returns the upstream tracking ref for the current branch (e.g. "origin/main"),
 * or null if no tracking branch is configured.
 */
export async function getUpstreamRef() {
  const git = simpleGit(process.cwd());
  try {
    const result = await git.raw(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    return result.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Returns the range of commits not yet pushed to the upstream tracking branch.
 * Returns { from: "origin/main", to: "HEAD", count: N } or null if nothing unpushed.
 */
export async function getUnpushedRange() {
  const git = simpleGit(process.cwd());
  const upstream = await getUpstreamRef();
  if (!upstream) return null;

  try {
    const result = await git.raw(["rev-list", "--count", `${upstream}..HEAD`]);
    const count = parseInt(result.trim(), 10);
    if (!count || count === 0) return null;
    return { from: upstream, to: "HEAD", count };
  } catch {
    return null;
  }
}

/**
 * Checks whether a group of commits has a non-empty net diff.
 * When squashing e.g. "add logs" + "remove logs", the combined patch is empty.
 * Returns true if there are actual net changes, false if the result would be empty.
 */
export async function hasNetChanges(hashes) {
  const git = simpleGit(process.cwd());
  try {
    const oldest = hashes[0];
    const newest = hashes[hashes.length - 1];
    // Compare the tree before the oldest commit with the tree at the newest
    const base = await git.raw(["rev-parse", `${oldest}^`]).catch(() => null);
    const ref = base ? base.trim() : oldest;
    const diff = await git.diffSummary([ref, newest]);
    return diff.files.length > 0;
  } catch {
    // If we can't determine, assume there are changes (safer default)
    return true;
  }
}

/**
 * Writes a git rebase -i todo list to disk.
 *
 * Receives an ordered flat list of groups (oldest-first) where every
 * commit in the range is accounted for — solo keep groups, squash groups,
 * or drop groups. The caller (analyze.js) builds this complete ordered list.
 *
 * Format:
 *   pick   <hash> <message>   — solo commit or squash group head
 *   squash <hash> <message>   — subsequent commits in a squash group
 *   drop   <hash> <message>   — commit to remove (net diff zero)
 */
export async function generateRebaseScript(groups, outputPath) {
  const { writeFileSync } = await import("fs");
  const lines = [];

  for (const group of groups) {
    if (group.type === "drop") {
      for (const c of group.commits) {
        lines.push(`drop ${c.shortHash} ${c.message}`);
      }
      lines.push("");

    } else if (group.type === "keep" || group.commits.length === 1) {
      const c = group.commits[0];
      lines.push(`pick ${c.shortHash} ${c.message}`);
      lines.push(""); // blank line between groups for readability
    } else {
      // squash group — oldest commit is the pick head
      const [oldest, ...rest] = group.commits;
      lines.push(`pick ${oldest.shortHash} ${group.squashedMessage || oldest.message}`);
      for (const c of rest) {
        lines.push(`squash ${c.shortHash} ${c.message}`);
      }
      lines.push(""); // blank line between groups for readability
    }
  }

  writeFileSync(outputPath, lines.join("\n"), "utf8");
  return outputPath;
}