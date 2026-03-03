import chalk from "chalk";
import ora from "ora";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import inquirer from "inquirer";

export async function applyCommand(rebaseFile, opts) {
  const filePath = path.resolve(process.cwd(), rebaseFile);

  if (!existsSync(filePath)) {
    console.error(chalk.red(`\n  Error: File not found — ${rebaseFile}\n`));
    process.exit(1);
  }

  const plan = readFileSync(filePath, "utf8").trim();
  const lines = plan.split("\n").filter((l) => l.trim());
  const pickCount   = lines.filter((l) => l.startsWith("pick")).length;
  const squashCount = lines.filter((l) => l.startsWith("squash")).length;

  // Extract all action lines in order: [{ action, hash, message }, ...]
  const actionLines = lines
    .filter((l) => l.startsWith("pick") || l.startsWith("squash"))
    .map((l) => {
      const [action, hash, ...rest] = l.split(/\s+/);
      return { action, hash, message: rest.join(" ") };
    });

  if (!actionLines.length) {
    console.error(chalk.red("\n  Error: No commits found in plan file.\n"));
    process.exit(1);
  }

  // Find the first commit that is part of a squash group.
  // That means: the first pick that is immediately followed by a squash,
  // OR the first squash itself — whichever comes first.
  // We only need to rebase from the parent of that commit onward.
  // Everything before it is an unchanged pick and doesn't need replaying.
  let firstChangedIndex = -1;
  for (let i = 0; i < actionLines.length; i++) {
    const isSquash = actionLines[i].action === "squash";
    const nextIsSquash = actionLines[i + 1]?.action === "squash";
    if (isSquash || nextIsSquash) {
      // Walk back to find the pick that heads this squash block
      let j = i;
      while (j > 0 && actionLines[j].action !== "pick") j--;
      firstChangedIndex = j;
      break;
    }
  }

  if (firstChangedIndex === -1) {
    // No squashes in the plan — nothing to do
    console.log(chalk.yellow("\n  No squash operations found in plan. Nothing to apply.\n"));
    return;
  }

  const baseHash = actionLines[firstChangedIndex].hash;

  // Find the parent of that commit to use as the rebase base
  let rebaseBase;
  let useRoot = false;
  try {
    rebaseBase = execSync(
      `git rev-parse --verify ${baseHash}^`,
      { cwd: process.cwd(), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
  } catch {
    // No parent — this is the root commit
    useRoot = true;
  }

  // Build the minimal plan: only the commits from firstChangedIndex onward.
  // The commits before that are untouched picks — no need to replay them.
  const relevantLines = actionLines.slice(firstChangedIndex);
  const minimalPlan = relevantLines
    .map((l) => `${l.action} ${l.hash} ${l.message}`)
    .join("\n") + "\n";

  // Write the minimal plan to a temp file
  const tmpPlanPath = filePath + ".minimal.tmp";
  const { writeFileSync } = await import("fs");
  writeFileSync(tmpPlanPath, minimalPlan, "utf8");

  // ── Display ────────────────────────────────────────────────────────────────
  console.log(chalk.bold(`\n  Rebase Plan: `) + chalk.dim(rebaseFile));
  console.log(chalk.dim(`  ${pickCount} picks, ${squashCount} squashes`));
  console.log(chalk.dim(`  Rebasing from: `) + chalk.cyan(baseHash) + chalk.dim(` (${actionLines[firstChangedIndex].message.slice(0, 50)})\n`));

  const preview = lines.slice(0, 12);
  for (const line of preview) {
    if (line.startsWith("pick")) {
      console.log("  " + chalk.green("pick   ") + chalk.dim(line.replace(/^pick\s+/, "")));
    } else if (line.startsWith("squash")) {
      console.log("  " + chalk.yellow("squash ") + chalk.dim(line.replace(/^squash\s+/, "")));
    }
  }
  if (lines.length > 12) {
    console.log(chalk.dim(`  … and ${lines.length - 12} more lines`));
  }

  if (opts.dryRun) {
    console.log(chalk.dim("\n  Dry run — rebase not executed.\n"));
    try { require("fs").unlinkSync(tmpPlanPath); } catch {}
    return;
  }

  console.log();
  console.log(
    chalk.yellow("  ⚠  Warning: ") +
    chalk.bold("This will rewrite git history.")
  );
  console.log(
    chalk.dim("  If this branch has been pushed, you'll need to ") +
    chalk.cyan("git push --force-with-lease") +
    chalk.dim(" after.\n")
  );

  const { confirmed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmed",
      message: "Proceed with interactive rebase?",
      default: false,
    },
  ]);

  if (!confirmed) {
    console.log(chalk.dim("\n  Cancelled. No changes made.\n"));
    try { (await import("fs")).unlinkSync(tmpPlanPath); } catch {}
    return;
  }

  const spinner = ora({ text: chalk.dim("Running git rebase…"), color: "blue" }).start();

  try {
    const absTmpPlan = tmpPlanPath.replace(/\\/g, "/");
    const rebaseTarget = useRoot ? "--root" : rebaseBase;
    execSync(
      `GIT_SEQUENCE_EDITOR="cp '${absTmpPlan}'" git rebase -i ${rebaseTarget}`,
      { stdio: "inherit", cwd: process.cwd() }
    );
    spinner.succeed(chalk.green("Rebase complete."));
    console.log(chalk.dim(`\n  Review your history with: `) + chalk.cyan("git log --oneline\n"));
  } catch (err) {
    spinner.fail(chalk.red("Rebase failed."));
    console.log(chalk.dim("\n  To abort: ") + chalk.cyan("git rebase --abort"));
    console.log(chalk.dim("  To continue after resolving conflicts: ") + chalk.cyan("git rebase --continue\n"));
  } finally {
    // Clean up temp file
    try { (await import("fs")).unlinkSync(tmpPlanPath); } catch {}
  }
}