import chalk from 'chalk';
import { getCommits } from '../core/git.js';

export async function statsCommand(opts) {
  const count = Number(opts.count ?? 100);
  console.log(chalk.dim('Analyzing...'));
  let commits;
  try { commits = await getCommits({ count }); }
  catch (err) { console.error(chalk.red(err.message)); process.exit(1); }
  const noisy = commits.filter((c) => /^(wip|temp|fix|fixup|minor|misc|update|cleanup|testing|test)\s*$/i.test(c.message.trim()));
  const large = commits.filter((c) => c.files.length > 15);
  const healthScore = Math.round(100 - (noisy.length / commits.length) * 50 - (large.length / commits.length) * 30);
  console.log(chalk.bold('\n  Commit Health\n'));
  console.log(`  Total   ${commits.length}`);
  console.log(`  Noisy   ${chalk.yellow(noisy.length)}`);
  console.log(`  Large   ${chalk.red(large.length)}`);
  console.log(`  Score   ${chalk.green(healthScore + '/100')}\n`);
}
