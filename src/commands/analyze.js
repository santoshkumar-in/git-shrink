import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import path from "path";
import { getCommits, generateRebaseScript, getUnpushedRange, hasNetChanges } from "../core/git.js";
import { groupCommits } from "../core/grouper.js";
import { renderGroupTable, renderSummaryBox } from "../utils/render.js";

export async function analyzeCommand(opts) {
  const threshold = Number(opts.threshold ?? 50);
  const minGroup  = Number(opts.minGroup  ?? 2);
  const count     = Number(opts.count     ?? 50);

  // ── 1. Fetch commits ────────────────────────────────────────────────────────
  const spinner = ora({ text: chalk.dim("Reading git history…"), color: "blue" }).start();

  const userSpecifiedRange = !!(opts.from || opts.count);
  let fetchOpts = { count, from: opts.from, to: opts.to, branch: opts.branch };

  if (!userSpecifiedRange) {
    const unpushed = await getUnpushedRange();
    if (unpushed) {
      fetchOpts = { from: unpushed.from, to: unpushed.to };
      spinner.text = chalk.dim(`Found ${unpushed.count} unpushed commit(s) — analyzing…`);
    }
  }

  let commits;
  try {
    commits = await getCommits(fetchOpts);
  } catch (err) {
    spinner.fail(chalk.red(err.message));
    process.exit(1);
  }

  spinner.succeed(
    chalk.green("Loaded") +
    chalk.bold(` ${commits.length} `) +
    chalk.green("commits")
  );

  // ── 2. Run grouping engine ──────────────────────────────────────────────────
  const groupSpinner = ora({ text: chalk.dim("Scoring commit pairs…"), color: "blue" }).start();
  const groups = groupCommits(commits, { threshold, minGroup });
  groupSpinner.stop();

  const candidateGroups = groups.filter((g) => g.type === "squash");
  const keepGroups      = groups.filter((g) => g.type === "keep");

  if (candidateGroups.length === 0) {
    console.log(chalk.yellow("\n  ✓ Your commit history looks clean. Nothing to squash.\n"));
    return;
  }

  // ── 3. Pre-check net diffs — flag cancel-out groups, don't classify yet ─────
  // We flag each group with isNetEmpty=true if its commits fully cancel out.
  // The final drop/squash/skip decision is made by the user in the prompt below.
  // In --auto mode we treat isNetEmpty groups as drops automatically.
  const diffSpinner = ora({ text: chalk.dim("Checking net diffs…"), color: "blue" }).start();
  for (const group of candidateGroups) {
    const hashes = group.commits.map((c) => c.hash);
    group.isNetEmpty = !(await hasNetChanges(hashes));
  }
  diffSpinner.stop();

  // ── 4. Summary ──────────────────────────────────────────────────────────────
  const netEmptyCount = candidateGroups.filter((g) => g.isNetEmpty).length;
  const totalBefore   = commits.length;
  // Rough estimate for display — exact number depends on user choices
  const totalAfter    = candidateGroups.length + keepGroups.length;
  const reduction     = Math.round((1 - totalAfter / totalBefore) * 100);

  console.log(
    "\n" +
    chalk.green("  Found ") +
    chalk.bold(`${candidateGroups.length}`) +
    chalk.green(" group(s) — history could shrink ") +
    chalk.bold.hex("#4a9eff")(`${totalBefore} → ${totalAfter} commits`) +
    chalk.green(` (${reduction}% reduction)`) +
    (netEmptyCount > 0 ? chalk.dim(`  [${netEmptyCount} cancel-out]`) : "")
  );

  // ── 5. Render group tables ──────────────────────────────────────────────────
  console.log();
  for (let i = 0; i < candidateGroups.length; i++) {
    renderGroupTable(candidateGroups[i], i + 1, candidateGroups.length);
    if (candidateGroups[i].isNetEmpty) {
      console.log(
        chalk.yellow("  ⚠  Net diff is zero") +
        chalk.dim(" — these commits fully cancel each other out.\n")
      );
    }
  }

  // ── 6. Dry-run exits here ───────────────────────────────────────────────────
  if (opts.dryRun) {
    renderSummaryBox({ totalBefore, totalAfter, reduction, squashGroups: candidateGroups, dryRun: true });
    console.log(chalk.dim("\n  Dry run — no files written.\n"));
    return;
  }

  // ── 7. Interactive review ───────────────────────────────────────────────────
  // cancel-out groups get a different prompt (Drop vs Skip, no Squash/Edit).
  // regular groups get the normal Squash / Edit / Skip prompt.
  // --auto: squash all regular groups, drop all cancel-out groups.
  const approvedGroups = []; // type="squash"
  const droppedGroups  = []; // type="drop"

  if (opts.auto) {
    for (const group of candidateGroups) {
      if (group.isNetEmpty) {
        group.type = "drop";
        droppedGroups.push(group);
      } else {
        approvedGroups.push(group);
      }
    }
  } else {
    console.log(chalk.bold.dim("  Review each group:\n"));

    for (const group of candidateGroups) {
      if (group.isNetEmpty) {
        // ── Cancel-out group prompt ──────────────────────────────────────────
        console.log(
          chalk.yellow("  ⚠  Group: ") +
          chalk.white(group.squashedMessage.slice(0, 60)) +
          chalk.dim(` (${group.commits.length} commits — net diff is zero)`)
        );

        const { action } = await inquirer.prompt([{
          type: "list",
          name: "action",
          message: "These commits fully undo each other. What do you want to do?",
          choices: [
            { name: chalk.red("✕ Drop both from history (safe — no changes lost)"), value: "drop" },
            { name: chalk.dim("— Skip (keep as individual picks)"),                  value: "skip" },
          ],
        }]);

        if (action === "drop") {
          group.type = "drop";
          droppedGroups.push(group);
          console.log(chalk.dim(`  → Marked for drop.\n`));
        } else {
          console.log(chalk.dim(`  → Kept as individual picks.\n`));
          // group stays type="squash" but won't be in approvedGroups,
          // so generateRebaseScript will emit each commit as a plain pick
          // (handled in step 9 via the keepGroups fallback)
          for (const c of group.commits) {
            keepGroups.push({ type: "keep", commits: [c], squashedMessage: c.message, avgScore: 0 });
          }
        }

      } else {
        // ── Regular squash group prompt ──────────────────────────────────────
        const { action } = await inquirer.prompt([{
          type: "list",
          name: "action",
          message:
            chalk.bold("Group: ") +
            chalk.hex("#4a9eff")(group.squashedMessage.slice(0, 60)) +
            chalk.dim(` (${group.commits.length} commits, score: ${group.avgScore})`),
          choices: [
            { name: chalk.green("✓ Squash this group"),       value: "squash" },
            { name: chalk.yellow("✎ Edit suggested message"), value: "edit"   },
            { name: chalk.red("✗ Skip this group"),           value: "skip"   },
          ],
        }]);

        if (action === "skip") {
          console.log(chalk.dim(`  → Kept as individual picks.\n`));
          continue;
        }

        if (action === "edit") {
          const { newMessage } = await inquirer.prompt([{
            type: "input",
            name: "newMessage",
            message: "  New commit message:",
            default: group.squashedMessage,
          }]);
          group.squashedMessage = newMessage;
        }

        approvedGroups.push(group);
      }
    }
  }

  if (approvedGroups.length === 0 && droppedGroups.length === 0) {
    console.log(chalk.yellow("\n  No groups approved. Nothing written.\n"));
    return;
  }

  // ── 8. Report what will be dropped ─────────────────────────────────────────
  if (droppedGroups.length > 0) {
    console.log(chalk.dim(`\n  Will drop ${droppedGroups.reduce((n, g) => n + g.commits.length, 0)} commit(s):`));
    for (const g of droppedGroups) {
      for (const c of g.commits) {
        console.log(chalk.dim("    ✕ ") + chalk.red(c.shortHash) + chalk.dim("  " + c.message));
      }
    }
    console.log();
  }

  // ── 9. Write plan ───────────────────────────────────────────────────────────
  // Build a complete ordered flat group list oldest-first.
  // Every commit in `commits` must appear exactly once so the plan is a
  // complete rebase todo — no commits silently dropped or duplicated.
  //
  // Strategy: walk commits oldest-first. For each commit, check if it
  // belongs to an approved squash group or dropped group. If yes, emit
  // that group (once) when we hit its first commit. Otherwise emit a
  // solo keep group.
  const approvedHashSet = new Map(); // shortHash → group
  for (const g of [...approvedGroups, ...droppedGroups]) {
    for (const c of g.commits) approvedHashSet.set(c.shortHash, g);
  }

  const emitted = new Set();
  const orderedGroups = [];

  for (const commit of [...commits].reverse()) { // oldest-first
    if (emitted.has(commit.shortHash)) continue;

    const group = approvedHashSet.get(commit.shortHash);
    if (group) {
      orderedGroups.push(group);
      for (const c of group.commits) emitted.add(c.shortHash);
    } else {
      // Not in any approved/drop group — plain pick
      orderedGroups.push({
        type: "keep",
        commits: [commit],
        squashedMessage: commit.message,
        avgScore: 0,
      });
      emitted.add(commit.shortHash);
    }
  }

  const outputFile = path.join(process.cwd(), `git-shrink-plan-${Date.now()}.txt`);
  await generateRebaseScript(orderedGroups, outputFile);

  const finalAfter = approvedGroups.length + keepGroups.length;
  renderSummaryBox({
    totalBefore,
    totalAfter: finalAfter,
    reduction: Math.round((1 - finalAfter / totalBefore) * 100),
    squashGroups: approvedGroups,
  });

  console.log(
    chalk.bold("\n  Rebase plan written to: ") +
    chalk.hex("#4a9eff")(path.basename(outputFile))
  );
  console.log(
    chalk.dim("\n  To apply:\n") +
    chalk.cyan(`    git-shrink apply ${path.basename(outputFile)}\n`)
  );
}