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
  const pickCount = lines.filter((l) => l.startsWith("pick")).length;
  const squashCount = lines.filter((l) => l.startsWith("squash")).length;
  const dropCount = lines.filter((l) => l.startsWith("drop")).length;

  // Extract all action lines in order: [{ action, hash, message }, ...]
  const actionLines = lines
    .filter((l) => l.startsWith("pick") || l.startsWith("squash") || l.startsWith("drop"))
    .map((l) => {
      const [action, hash, ...rest] = l.split(/\s+/);
      return { action, hash, message: rest.join(" ") };
    });

  if (!actionLines.length) {
    console.error(chalk.red("\n  Error: No commits found in plan file.\n"));
    process.exit(1);
  }

  // Find the first commit that requires a non-trivial rebase operation.
  // "squash" and "drop" both require replaying — only plain "pick" lines
  // that precede any squash/drop can be safely skipped.
  // We only need to rebase from the parent of the first changed commit onward.
  let firstChangedIndex = -1;
  for (let i = 0; i < actionLines.length; i++) {
    const action = actionLines[i].action;
    const nextAction = actionLines[i + 1]?.action;

    const isDrop = action === "drop";
    const isSquash = action === "squash";
    // A pick that is immediately followed by a squash heads a squash group
    const isSquashHead = action === "pick" && nextAction === "squash";

    if (isDrop || isSquash || isSquashHead) {
      // For squash blocks, walk back to the pick that heads the block
      let j = i;
      while (j > 0 && actionLines[j].action !== "pick" && actionLines[j].action !== "drop") j--;
      firstChangedIndex = j;
      break;
    }
  }

  if (firstChangedIndex === -1) {
    // All lines are plain picks — nothing to rewrite
    console.log(chalk.yellow("\n  No squash or drop operations found in plan. Nothing to apply.\n"));
    return;
  }

  // ── Guardrail: refuse if any commit in the plan is already pushed ──────────
  // Skip entirely if --force / -f was passed.
  if (!opts.force) {
    try {
      const pushedHashes = new Set(
        execSync("git log --remotes --format=%H", {
          cwd: process.cwd(), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
        }).trim().split("\n").filter(Boolean)
      );

      const alreadyPushed = actionLines.filter((l) => {
        try {
          const fullHash = execSync(`git rev-parse --verify ${l.hash}`, {
            cwd: process.cwd(), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
          }).trim();
          return pushedHashes.has(fullHash);
        } catch { return false; }
      });

      if (alreadyPushed.length > 0) {
        console.error(chalk.red("\n  ✖ Refusing to rewrite already-pushed commits:\n"));
        for (const c of alreadyPushed) {
          console.error(chalk.dim(`    ${c.hash} ${c.message}`));
        }
        console.error(
          "\n" + chalk.yellow("  Tip: ") +
          chalk.dim("Only run git-shrink apply on commits that haven't been pushed yet.") +
          "\n" + chalk.dim("  Scope to unpushed only with: ") +
          chalk.cyan("git-shrink analyze --from origin/main") +
          "\n" + chalk.dim("  Or to bypass this check on a feature branch: ") +
          chalk.cyan("git-shrink apply <file> --force\n")
        );
        process.exit(1);
      }
    } catch (err) {
      // No remotes configured, or rev-parse failed — skip the guardrail silently
      if (err.code === 1 && err.message?.includes("process.exit")) throw err;
    }
  } else {
    console.log(
      chalk.yellow("  ⚠  --force: ") +
      chalk.dim("Pushed-commit guardrail skipped. Remember to git push --force-with-lease after.\n")
    );
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
  const dropLabel = dropCount > 0 ? `, ${dropCount} drops` : "";
  console.log(chalk.dim(`  ${pickCount} picks, ${squashCount} squashes${dropLabel}`));
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
    try { require("fs").unlinkSync(tmpPlanPath); } catch { }
    return;
  }

  console.log();
  console.log(
    chalk.yellow("  ⚠  Warning: ") +
    chalk.bold("This will rewrite git history.")
  );
  if (opts.force) {
    console.log(
      chalk.dim("  This branch has pushed commits. You ") +
      chalk.bold.yellow("must") +
      chalk.dim(" run ") +
      chalk.cyan("git push --force-with-lease") +
      chalk.dim(" after to sync with remote.\n")
    );
  } else {
    console.log(
      chalk.dim("  If this branch has been pushed, you'll need to ") +
      chalk.cyan("git push --force-with-lease") +
      chalk.dim(" after.\n")
    );
  }

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
    try { (await import("fs")).unlinkSync(tmpPlanPath); } catch { }
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

    // Clean up plan file unless opted out via --no-cleanup or config
    if (opts.cleanupPlan !== false) {
      try {
        const { unlinkSync } = await import("fs");
        unlinkSync(filePath);
        console.log(chalk.dim(`  Plan file removed: ${path.basename(filePath)}`));
      } catch {
        // Non-fatal — file may have already been moved/deleted
      }
    }

    console.log(chalk.dim(`\n  Review your history with: `) + chalk.cyan("git log --oneline\n"));
    // eslint-disable-next-line no-unused-vars
  } catch (_err) {
    spinner.fail(chalk.red("Rebase failed."));
    console.log(chalk.dim("\n  To abort: ") + chalk.cyan("git rebase --abort"));
    console.log(chalk.dim("  To continue after resolving conflicts: ") + chalk.cyan("git rebase --continue\n"));
  } finally {
    // Clean up temp file
    try { (await import("fs")).unlinkSync(tmpPlanPath); } catch { }
  }
}