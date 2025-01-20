import chalk from 'chalk';
import { getCommits, generateRebaseScript } from '../core/git.js';
import { groupCommits } from '../core/grouper.js';
import { renderGroupTable, renderSummaryBox } from '../utils/render.js';
import inquirer from 'inquirer';
import path from 'path';

export async function analyzeCommand(opts) {
  const threshold = Number(opts.threshold ?? 60);
  const minGroup  = Number(opts.minGroup  ?? 2);
  const count     = Number(opts.count     ?? 50);

  const ora = (await import('ora')).default;
  const spinner = ora({ text: chalk.dim('Reading git history…'), color: 'blue' }).start();
  let commits;
  try { commits = await getCommits({ count, from: opts.from, to: opts.to, branch: opts.branch }); }
  catch (err) { spinner.fail(chalk.red(err.message)); process.exit(1); }
  spinner.succeed(chalk.green(`Loaded ${commits.length} commits`));

  const groups = groupCommits(commits, { threshold, minGroup });
  const squashGroups = groups.filter((g) => g.type === 'squash');
  if (squashGroups.length === 0) { console.log(chalk.yellow('\n  ✓ History looks clean.\n')); return; }
  if (opts.dryRun) { renderSummaryBox({ totalBefore: commits.length, totalAfter: groups.length, reduction: Math.round((1 - groups.length/commits.length)*100), squashGroups, dryRun: true }); return; }
  for (let i = 0; i < squashGroups.length; i++) renderGroupTable(squashGroups[i], i+1, squashGroups.length);

  const keepGroups  = groups.filter((g) => g.type === 'keep');
  const totalAfter  = squashGroups.length + keepGroups.length;
  const reduction   = Math.round((1 - totalAfter / commits.length) * 100);
  renderSummaryBox({ totalBefore: commits.length, totalAfter, reduction, squashGroups });

  const outputFile = path.join(process.cwd(), `git-shrink-plan-${Date.now()}.txt`);
  await generateRebaseScript([...squashGroups, ...keepGroups].sort((a,b) => b.commits[0].date - a.commits[0].date), outputFile);
  console.log(chalk.dim('\n  Plan written to: ') + chalk.cyan(path.basename(outputFile)));

  if (!opts.auto) {
    for (const group of squashGroups) {
      const { action } = await inquirer.prompt([{ type: 'list', name: 'action', message: 'Squash this group?', choices: ['squash', 'skip'] }]);
      if (action === 'skip') continue;
    }
  }

}
