import chalk from "chalk";
import Table from "cli-table3";

/**
 * Renders a single squash group as a formatted table.
 */
export function renderGroupTable(group, index, total) {
  console.log(
    chalk.bold(`  Group ${index}/${total}`) +
    chalk.dim(" — ") +
    chalk.italic.dim(group.reason)
  );
  console.log(
    "  " + chalk.dim("Suggested message: ") +
    chalk.hex("#4a9eff").bold(`"${group.squashedMessage.slice(0, 72)}"`)
  );
  console.log(
    "  " + chalk.dim("Similarity score:  ") +
    renderScoreBar(group.avgScore, 20, group.avgScore >= 75 ? "green" : "yellow") +
    "  " + chalk.bold(`${group.avgScore}/100`)
  );
  console.log();

  const table = new Table({
    head: [
      chalk.dim("Hash"),
      chalk.dim("Message"),
      chalk.dim("Files"),
      chalk.dim("Date"),
    ],
    colWidths: [10, 52, 7, 14],
    style: { head: [], border: ["dim"] },
    chars: {
      top: "─", "top-mid": "┬", "top-left": "┌", "top-right": "┐",
      bottom: "─", "bottom-mid": "┴", "bottom-left": "└", "bottom-right": "┘",
      left: "│", "left-mid": "├", mid: "─", "mid-mid": "┼",
      right: "│", "right-mid": "┤", middle: "│",
    },
  });

  for (const [i, c] of group.commits.entries()) {
    const isFirst = i === 0;
    table.push([
      isFirst ? chalk.green(c.shortHash) : chalk.yellow(c.shortHash),
      (c.message.length > 49 ? c.message.slice(0, 46) + "…" : c.message),
      String(c.files.length),
      formatRelativeDate(c.date),
    ]);
  }

  console.log(table.toString());
  console.log();
}

/**
 * Renders the final summary box.
 */
export function renderSummaryBox({ totalBefore, totalAfter, reduction, squashGroups, dryRun = false }) {
  const label = dryRun ? chalk.yellow("  DRY RUN — Summary") : chalk.bold.green("  Summary");
  console.log(`\n${label}`);
  console.log(chalk.dim("  ─────────────────────────────"));
  console.log(
    "  Commits before  " + chalk.bold(String(totalBefore).padStart(6))
  );
  console.log(
    "  Commits after   " + chalk.bold.green(String(totalAfter).padStart(6))
  );
  console.log(
    "  Reduction       " + chalk.bold.hex("#4a9eff")(`${reduction}%`.padStart(6))
  );
  console.log(
    "  Groups squashed " + chalk.bold(String(squashGroups.length).padStart(6))
  );
  console.log(chalk.dim("  ─────────────────────────────\n"));
}

/**
 * Renders a simple ASCII progress/score bar.
 */
export function renderScoreBar(score, width = 20, color = "blue") {
  const filled = Math.round((score / 100) * width);
  const empty  = width - filled;
  const colors = {
    green: "#3fb95a", blue: "#4a9eff", yellow: "#e8a455",
    red: "#f05151", purple: "#a27cf8",
  };
  const c = colors[color] || colors.blue;
  return chalk.hex(c)("█".repeat(filled)) + chalk.dim("░".repeat(empty));
}

/**
 * Human-friendly relative date.
 */
function formatRelativeDate(date) {
  const now = Date.now();
  const diff = now - date;
  const min  = Math.floor(diff / 60000);
  const hr   = Math.floor(diff / 3600000);
  const day  = Math.floor(diff / 86400000);
  if (min < 60)  return `${min}m ago`;
  if (hr  < 24)  return `${hr}h ago`;
  if (day < 30)  return `${day}d ago`;
  return date.toISOString().slice(0, 10);
}
