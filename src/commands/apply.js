import chalk from "chalk";
import ora from "ora";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "fs";
import { execFileSync } from "child_process";
import path from "path";
import inquirer from "inquirer";

/**
 * apply.js
 *
 * The plan file written by generateRebaseScript is a complete, ordered
 * git rebase -i todo list:
 *
 *   pick 24ec316 feat: add login endpoint
 *   pick 345da1f wip
 *   ...
 *   pick 9c34c45 remove feature flag for dark mode
 *   pick 58434d0 fix                    ← squash group head
 *   squash bd08502 fix again
 *   squash 158cddb wip
 *   squash 3a5369c temp
 *
 *   pick 8a8998a ok now it works
 *   ...
 *
 * To apply it we need to know how far back to rebase from. We find the
 * FIRST commit in the plan that is either a squash head or a drop, then
 * rebase from its parent — git replays everything from there using our
 * plan as the sequence editor output.
 */

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd: cwd || process.cwd(),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

export async function applyCommand(planFile, opts) {
  const filePath = path.resolve(process.cwd(), planFile);
  const cwd      = process.cwd();

  if (!existsSync(filePath)) {
    console.error(chalk.red(`\n  Error: File not found — ${planFile}\n`));
    process.exit(1);
  }

  const planText = readFileSync(filePath, "utf8");
  const lines    = planText.split("\n").map((l) => l.trim()).filter(Boolean);

  // Parse all action lines
  const actionLines = lines
    .filter((l) => /^(pick|squash|drop)\s/.test(l))
    .map((l) => {
      const [action, hash, ...rest] = l.split(/\s+/);
      return { action, hash, message: rest.join(" ") };
    });

  if (!actionLines.length) {
    console.log(chalk.yellow("\n  No commits found in plan. Nothing to apply.\n"));
    return;
  }

  const squashCount = actionLines.filter((l) => l.action === "squash").length;
  const dropCount   = actionLines.filter((l) => l.action === "drop").length;

  if (!squashCount && !dropCount) {
    console.log(chalk.yellow("\n  No squash or drop operations in plan. Nothing to apply.\n"));
    return;
  }

  // ── Find the rebase anchor ─────────────────────────────────────────────────
  // The first commit that needs rewriting is either:
  //   - a squash head: a pick whose next action line is a squash
  //   - a drop
  // We rebase from the parent of that commit.
  let firstChangedIdx = -1;
  for (let i = 0; i < actionLines.length; i++) {
    const curr = actionLines[i];
    const next = actionLines[i + 1];
    if (curr.action === "drop") { firstChangedIdx = i; break; }
    if (curr.action === "pick" && next?.action === "squash") { firstChangedIdx = i; break; }
  }

  if (firstChangedIdx === -1) {
    console.log(chalk.yellow("\n  No squash or drop operations found. Nothing to apply.\n"));
    return;
  }

  const anchorHash = actionLines[firstChangedIdx].hash;
  let rebaseBase;
  let useRoot = false;
  try {
    rebaseBase = git(["rev-parse", "--verify", `${anchorHash}^`], cwd);
  } catch {
    useRoot = true;
  }

  // ── Preview ────────────────────────────────────────────────────────────────
  console.log(chalk.bold("\n  Plan: ") + chalk.dim(planFile));
  console.log(chalk.dim(`  ${squashCount} squash(es), ${dropCount} drop(s)\n`));

  // Show a window: a few lines before the first squash group + the group itself
  const previewStart = Math.max(0, firstChangedIdx - 2);
  const previewEnd   = Math.min(actionLines.length - 1, firstChangedIdx + squashCount + 3);

  if (previewStart > 0) {
    console.log(chalk.dim(`  … ${previewStart} earlier pick(s) …`));
  }
  for (let i = previewStart; i <= previewEnd; i++) {
    const l = actionLines[i];
    if (l.action === "pick") {
      const isHead = actionLines[i + 1]?.action === "squash";
      console.log(
        "  " + chalk.green("pick   ") +
        chalk.dim(l.hash) + " " +
        (isHead ? chalk.white(l.message) : chalk.dim(l.message))
      );
    } else if (l.action === "squash") {
      console.log("  " + chalk.yellow("squash ") + chalk.dim(l.hash) + " " + chalk.dim(l.message));
    } else if (l.action === "drop") {
      console.log("  " + chalk.red("drop   ") + chalk.dim(l.hash) + " " + chalk.dim(l.message));
    }
  }
  if (previewEnd < actionLines.length - 1) {
    console.log(chalk.dim(`  … ${actionLines.length - 1 - previewEnd} later pick(s) …`));
  }
  console.log();

  // ── Pushed-commit guardrail ────────────────────────────────────────────────
  if (!opts.force) {
    try {
      const pushedSet = new Set(
        git(["log", "--remotes", "--format=%H"], cwd).split("\n").filter(Boolean)
      );
      const nonPickHashes = actionLines
        .filter((l) => l.action !== "pick" || actionLines[actionLines.indexOf(l) + 1]?.action === "squash")
        .map((l) => {
          try { return git(["rev-parse", "--verify", l.hash], cwd); } catch { return null; }
        })
        .filter(Boolean);

      const pushed = nonPickHashes.filter((h) => pushedSet.has(h));
      if (pushed.length) {
        console.error(chalk.red("  ✖ Refusing to rewrite already-pushed commits."));
        console.error(chalk.dim("  Use --force to bypass on a feature branch.\n"));
        process.exit(1);
      }
    } catch (err) {
      if (err.code === 1 && err.message?.includes("process.exit")) throw err;
    }
  }

  // ── Dry-run exits here ─────────────────────────────────────────────────────
  if (opts.dryRun) {
    console.log(chalk.dim("  Dry run — rebase not executed.\n"));
    return;
  }

  // ── Confirm ────────────────────────────────────────────────────────────────
  console.log(chalk.yellow("  ⚠  This will rewrite git history.\n"));

  const { confirmed } = await inquirer.prompt([{
    type: "confirm",
    name: "confirmed",
    message: "Proceed with interactive rebase?",
    default: false,
  }]);

  if (!confirmed) {
    console.log(chalk.dim("\n  Cancelled. No changes made.\n"));
    return;
  }

  // ── Execute ────────────────────────────────────────────────────────────────
  // Write the plan to a temp file. We pass it to git via GIT_SEQUENCE_EDITOR
  // which git calls instead of opening an editor — it receives the default
  // todo file path as $1 and we overwrite it with our plan.
  const tmpPlan = filePath + ".tmp";
  const spinner = ora({ text: chalk.dim("Running rebase…"), color: "blue" }).start();

  try {
    // The plan is already a valid rebase todo — but we need to rebuild it
    // containing only the commits from our anchor forward (git rebase -i
    // only shows commits reachable from the base, so extra lines are ignored,
    // but it's cleaner to write only the relevant slice).
    const relevantLines = actionLines.slice(firstChangedIdx);
    const todoContent = relevantLines
      .map((l) => `${l.action} ${l.hash} ${l.message}`)
      .join("\n") + "\n";

    writeFileSync(tmpPlan, todoContent, "utf8");

    const absTmp       = tmpPlan.replace(/\\/g, "/");
    const rebaseTarget = useRoot ? "--root" : rebaseBase;

    // GIT_SEQUENCE_EDITOR receives the path to the default todo file as $1.
    // We ignore it and overwrite with our plan using cp.
    execFileSync(
      "bash", ["-c", `GIT_SEQUENCE_EDITOR="cp '${absTmp}'" git rebase -i ${rebaseTarget}`],
      { stdio: "inherit", cwd }
    );

    spinner.succeed(chalk.green("Rebase complete."));
    console.log(chalk.dim(`\n  Review: `) + chalk.cyan("git log --oneline\n"));

    try { unlinkSync(filePath); } catch {}

  } catch (err) {
    spinner.fail(chalk.red("Rebase failed."));
    console.log(chalk.dim("\n  To abort:    ") + chalk.cyan("git rebase --abort"));
    console.log(chalk.dim("  To continue: ") + chalk.cyan("git rebase --continue\n"));
    process.exit(1);
  } finally {
    try { unlinkSync(tmpPlan); } catch {}
  }
}