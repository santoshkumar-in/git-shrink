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
    // Explicit range: from..to
    log = await git.log({ from, to: to || "HEAD", "--no-merges": null });
  } else {
    // Default: last N commits from HEAD (or named branch)
    log = await git.log({
      "--max-count": String(count || 50),
      "--no-merges": null,
      ...(branch && branch !== "HEAD" ? { to: branch } : {}),
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
 * Writes a git-rebase todo script to disk.
 */
export async function generateRebaseScript(groups, outputPath) {
  const { writeFileSync } = await import("fs");
  const lines = [];

  for (const group of groups) {
    // commits are sorted oldest-first — oldest is the pick base, rest are squashed into it
    const [oldest, ...rest] = group.commits;
    if (group.commits.length === 1) {
      lines.push(`pick ${oldest.shortHash} ${oldest.message}`);
    } else {
      lines.push(`pick ${oldest.shortHash} ${group.squashedMessage || oldest.message}`);
      for (const c of rest) {
        lines.push(`squash ${c.shortHash} ${c.message}`);
      }
    }
    lines.push(""); // blank line between groups for readability
  }

  writeFileSync(outputPath, lines.join("\n"), "utf8");
  return outputPath;
}