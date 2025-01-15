import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

export async function applyCommand(rebaseFile, opts) {
  const filePath = path.resolve(process.cwd(), rebaseFile);
  if (!existsSync(filePath)) { console.error(chalk.red(`File not found: ${rebaseFile}`)); process.exit(1); }
  const plan = readFileSync(filePath, 'utf8').trim();
  const lines = plan.split('\n').filter((l) => l.trim());
  const pickCount   = lines.filter((l) => l.startsWith('pick')).length;
  const squashCount = lines.filter((l) => l.startsWith('squash')).length;
  console.log(chalk.bold(`\n  Rebase Plan: `) + chalk.dim(rebaseFile));
  console.log(chalk.yellow('\n  ⚠  This will rewrite git history.\n'));
  try {
    const absFile = filePath.replace(/\\/g, '/');
    execSync(`GIT_SEQUENCE_EDITOR="cp '${absFile}'" git rebase -i HEAD~${pickCount + squashCount}`, { stdio: 'inherit', cwd: process.cwd() });
    console.log(chalk.green('\nRebase complete.'));
  } catch (err) {
    console.log(chalk.red('\nRebase failed.'));
    console.log(chalk.dim('To abort: ') + chalk.cyan('git rebase --abort'));
  }
}
