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

  console.log(chalk.bold(`\n  Rebase Plan: `) + chalk.dim(rebaseFile));
  console.log(chalk.dim(`  ${pickCount} picks, ${squashCount} squashes\n`));

  // Print a preview
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
    return;
  }

  const spinner = ora({ text: chalk.dim("Running git rebase…"), color: "blue" }).start();

  try {
    // We use GIT_SEQUENCE_EDITOR to feed our plan directly into the rebase
    const absFile = filePath.replace(/\\/g, "/");
    execSync(
      `GIT_SEQUENCE_EDITOR="cp '${absFile}'" git rebase -i --autosquash HEAD~${pickCount + squashCount}`,
      { stdio: "inherit", cwd: process.cwd() }
    );
    spinner.succeed(chalk.green("Rebase complete."));
    console.log(chalk.dim(`\n  Review your history with: `) + chalk.cyan("git log --oneline\n"));
  } catch (err) {
    spinner.fail(chalk.red("Rebase failed."));
    console.log(chalk.dim("\n  To abort: ") + chalk.cyan("git rebase --abort"));
    console.log(chalk.dim("  To continue after resolving conflicts: ") + chalk.cyan("git rebase --continue\n"));
  }
}
