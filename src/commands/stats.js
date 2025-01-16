import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";
import { getCommits } from "../core/git.js";
import { renderScoreBar } from "../utils/render.js";

export async function statsCommand(opts) {
  const count = Number(opts.count ?? 100);

  const spinner = ora({ text: chalk.dim("Analyzing commit health…"), color: "blue" }).start();

  let commits;
  try {
    commits = await getCommits({ count });
  } catch (err) {
    spinner.fail(chalk.red(err.message));
    process.exit(1);
  }

  spinner.stop();

  // ── Compute stats ───────────────────────────────────────────────────────────
  const noisePatterns = [
    /^(wip|temp|fix|fixup|quick fix|minor|misc|update|cleanup|clean up|testing|test)\s*$/i,
    /^\.+$/,
    /^[\w\s]{1,8}$/,
  ];

  const noisyCommits    = commits.filter((c) => noisePatterns.some((r) => r.test(c.message.trim())));
  const emptyFileCommits = commits.filter((c) => c.files.length === 0);
  const largeCommits    = commits.filter((c) => c.files.length > 15);
  const goodCommits     = commits.filter((c) =>
    !noisePatterns.some((r) => r.test(c.message.trim())) &&
    c.files.length > 0 &&
    c.files.length <= 15
  );

  // Author breakdown
  const authorMap = new Map();
  for (const c of commits) {
    authorMap.set(c.author, (authorMap.get(c.author) || 0) + 1);
  }
  const topAuthors = [...authorMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Most-touched directories
  const dirMap = new Map();
  for (const c of commits) {
    for (const d of c.dirs) {
      if (d !== ".") dirMap.set(d, (dirMap.get(d) || 0) + 1);
    }
  }
  const hotDirs = [...dirMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Health score (0–100)
  const noiseRatio   = noisyCommits.length / commits.length;
  const largeRatio   = largeCommits.length / commits.length;
  const healthScore  = Math.round(100 - (noiseRatio * 50) - (largeRatio * 30));

  // ── Render ──────────────────────────────────────────────────────────────────
  console.log(chalk.bold("\n  Repository Commit Health\n"));

  // Summary row
  const summaryTable = new Table({
    style: { head: [], border: ["dim"] },
    chars: { mid: "─", "left-mid": "├", "right-mid": "┤", middle: "┼" },
  });

  summaryTable.push(
    [chalk.dim("Total commits"), chalk.bold(commits.length)],
    [chalk.green("Clean commits"), chalk.bold.green(goodCommits.length)],
    [chalk.yellow("Noisy commits"), chalk.bold.yellow(noisyCommits.length)],
    [chalk.red("Oversized commits (>15 files)"), chalk.bold.red(largeCommits.length)],
    [chalk.dim("Empty-diff commits"), chalk.bold.dim(emptyFileCommits.length)],
  );
  console.log(summaryTable.toString());

  // Health score bar
  console.log();
  const scoreColor = healthScore >= 75 ? "green" : healthScore >= 50 ? "yellow" : "red";
  console.log(
    "  Health Score  " +
    renderScoreBar(healthScore, 30, scoreColor) +
    "  " + chalk.bold[scoreColor](`${healthScore}/100`)
  );

  if (noisyCommits.length > 0) {
    console.log(chalk.bold("\n  Noisy Commits (sample)\n"));
    noisyCommits.slice(0, 8).forEach((c) => {
      console.log(
        "  " + chalk.dim(c.shortHash) + "  " +
        chalk.yellow(`"${c.message}"`) +
        chalk.dim(`  ${c.author}`)
      );
    });
  }

  if (hotDirs.length > 0) {
    console.log(chalk.bold("\n  Hot Directories\n"));
    hotDirs.forEach(([dir, count]) => {
      console.log(
        "  " + chalk.hex("#4a9eff")(dir.padEnd(35)) +
        renderScoreBar(Math.round((count / commits.length) * 100), 20, "blue") +
        chalk.dim(`  ${count} commits`)
      );
    });
  }

  console.log(chalk.bold("\n  Top Contributors\n"));
  topAuthors.forEach(([author, count]) => {
    console.log(
      "  " + chalk.white(author.padEnd(25)) +
      renderScoreBar(Math.round((count / commits.length) * 100), 20, "purple") +
      chalk.dim(`  ${count} commits`)
    );
  });

  // Recommendation
  console.log();
  if (noiseRatio > 0.25) {
    console.log(
      chalk.yellow("  ⚠  ") +
      chalk.bold(`${Math.round(noiseRatio * 100)}% of commits are noisy.`) +
      chalk.dim("  Run ") + chalk.cyan("git-shrink analyze") + chalk.dim(" to clean up.\n")
    );
  } else {
    console.log(chalk.green("  ✓  History looks reasonably clean.\n"));
  }
}
