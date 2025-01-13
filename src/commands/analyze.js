import chalk from 'chalk';
import { getCommits } from '../core/git.js';
import { groupCommits } from '../core/grouper.js';
import { renderGroupTable, renderSummaryBox } from '../utils/render.js';
import path from 'path';

export async function analyzeCommand(opts) {
  const threshold = Number(opts.threshold ?? 60);
  const minGroup  = Number(opts.minGroup  ?? 2);
  const count     = Number(opts.count     ?? 50);

  console.log(chalk.dim('Loading commits...'));
  let commits;
  try { commits = await getCommits({ count }); }
  catch (err) { console.error(chalk.red(err.message)); process.exit(1); }

  const groups = groupCommits(commits, { threshold, minGroup });
  const squashGroups = groups.filter((g) => g.type === 'squash');
  for (let i = 0; i < squashGroups.length; i++) renderGroupTable(squashGroups[i], i+1, squashGroups.length);

  const totalAfter = groups.length;
  const reduction  = Math.round((1 - totalAfter / commits.length) * 100);
  renderSummaryBox({ totalBefore: commits.length, totalAfter, reduction, squashGroups });
}
