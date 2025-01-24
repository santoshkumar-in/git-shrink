import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import { createRequire } from "module";
import path from "path";
import { writeFileSync } from "fs";
import { getCommits, generateRebaseScript } from "../core/git.js";
import { groupCommits } from "../core/grouper.js";
import { renderGroupTable, renderSummaryBox, renderScoreBar } from "../utils/render.js";

export async function analyzeCommand(opts) {
  const threshold  = Number(opts.threshold  ?? 60);
  const minGroup   = Number(opts.minGroup   ?? 2);
  const count      = Number(opts.count      ?? 50);

  // ── 1. Fetch commits ────────────────────────────────────────────────────────
  const spinner = ora({ text: chalk.dim("Reading git history…"), color: "blue" }).start();

  let commits;
  try {
    commits = await getCommits({ count, from: opts.from, to: opts.to, branch: opts.branch });
  } catch (err) {
    spinner.fail(chalk.red(err.message));
    process.exit(1);
  }

  spinner.succeed(
    chalk.green(`Loaded`) +
    chalk.bold(` ${commits.length} `) +
    chalk.green("commits")
  );

  // ── 2. Run grouping engine ──────────────────────────────────────────────────
  const groupSpinner = ora({ text: chalk.dim("Scoring commit pairs…"), color: "blue" }).start();

  const groups = groupCommits(commits, { threshold, minGroup });

  const squashGroups  = groups.filter((g) => g.type === "squash");
  const keepGroups    = groups.filter((g) => g.type === "keep");
  const totalBefore   = commits.length;
  const totalAfter    = squashGroups.length + keepGroups.length;
  const reduction     = Math.round((1 - totalAfter / totalBefore) * 100);

  groupSpinner.succeed(
    chalk.green(`Found `) +
    chalk.bold(`${squashGroups.length}`) +
    chalk.green(` squash group(s) — history shrinks `) +
    chalk.bold.hex("#4a9eff")(`${totalBefore} → ${totalAfter} commits`) +
    chalk.green(` (${reduction}% reduction)`)
  );

  if (squashGroups.length === 0) {
    console.log(chalk.yellow("\n  ✓ Your commit history looks clean. Nothing to squash.\n"));
    return;
  }

  // ── 3. Render groups ────────────────────────────────────────────────────────
  console.log();
  for (let i = 0; i < squashGroups.length; i++) {
    const g = squashGroups[i];
    renderGroupTable(g, i + 1, squashGroups.length);
  }

  // ── 4. Dry-run exits here ───────────────────────────────────────────────────
  if (opts.dryRun) {
    renderSummaryBox({ totalBefore, totalAfter, reduction, squashGroups, dryRun: true });
    console.log(chalk.dim("\n  Dry run — no files written.\n"));
    return;
  }

  // ── 5. Auto mode skips prompts ─────────────────────────────────────────────
  let approvedGroups = [...squashGroups];

  if (!opts.auto) {
    console.log(chalk.bold.dim("  Review each group:\n"));

    approvedGroups = [];
    for (const group of squashGroups) {
      const { action } = await inquirer.prompt([
        {
          type: "list",
          name: "action",
          message:
            chalk.bold(`Group: `) +
            chalk.hex("#4a9eff")(group.squashedMessage.slice(0, 60)) +
            chalk.dim(` (${group.commits.length} commits, score: ${group.avgScore})`),
          choices: [
            { name: chalk.green("✓ Squash this group"), value: "squash" },
            { name: chalk.yellow("✎ Edit suggested message"), value: "edit" },
            { name: chalk.red("✗ Skip this group"), value: "skip" },
          ],
        },
      ]);

      if (action === "skip") continue;

      if (action === "edit") {
        const { newMessage } = await inquirer.prompt([
          {
            type: "input",
            name: "newMessage",
            message: "  New commit message:",
            default: group.squashedMessage,
          },
        ]);
        group.squashedMessage = newMessage;
      }

      approvedGroups.push(group);
    }
  }

  if (approvedGroups.length === 0) {
    console.log(chalk.yellow("\n  No groups approved. Nothing written.\n"));
    return;
  }

  // ── 6. Build final group list (approved squashes + solo keeps) ─────────────
  const finalGroups = [
    ...approvedGroups,
    ...keepGroups,
  ].sort((a, b) => b.commits[0].date - a.commits[0].date);

  // ── 7. Write rebase script ─────────────────────────────────────────────────
  const outputFile = path.join(process.cwd(), `git-shrink-plan-${Date.now()}.txt`);
  await generateRebaseScript(finalGroups, outputFile);

  renderSummaryBox({ totalBefore, totalAfter: finalGroups.length, reduction, squashGroups: approvedGroups });

  console.log(
    chalk.bold("\n  Rebase plan written to: ") +
    chalk.hex("#4a9eff")(path.basename(outputFile))
  );
  console.log(
    chalk.dim("\n  To apply:\n") +
    chalk.cyan(`    git-shrink apply ${path.basename(outputFile)}\n`) +
    chalk.dim("  Or manually:\n") +
    chalk.cyan(`    GIT_SEQUENCE_EDITOR="cp ${path.basename(outputFile)}" git rebase -i HEAD~${count}\n`)
  );
}
