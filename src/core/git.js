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

  const range = from ? `${from}..${to || "HEAD"}` : `${branch || "HEAD"}~${count || 50}..HEAD`;

  // Fetch log with stat info
  const log = await git.log({
    from: from,
    to: to || branch || "HEAD",
    "--max-count": from ? undefined : String(count || 50),
    "--stat": null,
  });

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
 * Writes a git-rebase todo script to disk.
 */
export async function generateRebaseScript(groups, outputPath) {
  const { writeFileSync } = await import("fs");
  const lines = [];

  for (const group of groups) {
    if (group.commits.length === 1) {
      lines.push(`pick ${group.commits[0].shortHash} ${group.commits[0].message}`);
    } else {
      const [head, ...rest] = group.commits;
      lines.push(`pick ${head.shortHash} ${group.squashedMessage || head.message}`);
      for (const c of rest) {
        lines.push(`squash ${c.shortHash} ${c.message}`);
      }
    }
    lines.push(""); // blank line between groups for readability
  }

  writeFileSync(outputPath, lines.join("\n"), "utf8");
  return outputPath;
}
