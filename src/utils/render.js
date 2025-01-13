import chalk from 'chalk';

export function renderGroupTable(group, index, total) {
  console.log(chalk.bold(`\n  Group ${index}/${total}`) + chalk.dim(' — ') + chalk.dim(group.reason));
  console.log('  ' + chalk.dim('Suggested: ') + chalk.cyan(`"${group.squashedMessage.slice(0, 72)}"`));
  for (const c of group.commits) console.log('  ' + chalk.yellow(c.shortHash) + '  ' + c.message);
}

export function renderSummaryBox({ totalBefore, totalAfter, reduction, squashGroups, dryRun = false }) {
  console.log(dryRun ? chalk.yellow('\n  DRY RUN') : chalk.green('\n  Done'));
  console.log(`  ${totalBefore} → ${totalAfter} commits (${reduction}% reduction)`);
}

export function renderScoreBar(score, width = 20, color = 'blue') {
  const filled = Math.round((score / 100) * width);
  return chalk.blue('█'.repeat(filled)) + chalk.dim('░'.repeat(width - filled));
}
