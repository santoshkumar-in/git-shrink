#!/usr/bin/env node
import { program } from 'commander';
import chalk from 'chalk';
import { analyzeCommand } from './commands/analyze.js';
import { applyCommand } from './commands/apply.js';
import { statsCommand } from './commands/stats.js';

program.name('git-shrink').version('0.1.0').description('Intelligently compresses bloated git histories');
program.command('analyze').alias('a').description('Analyze commits and suggest groupings')
  .option('-n, --count <number>', 'number of commits to analyze from HEAD', '50')
  .option('--auto', 'skip interactive mode')
  .option('--dry-run', 'show what would change')
  .option('--threshold <score>', 'similarity score threshold (0-100)', '60')
  .action(async (opts) => { await analyzeCommand(opts); });
program.command('apply <rebase-file>').alias('ap').description('Apply a rebase script')
  .option('--dry-run', 'validate without executing')
  .action(async (rebaseFile, opts) => { await applyCommand(rebaseFile, opts); });
program.command('stats').alias('s').description('Show commit health stats')
  .option('-n, --count <number>', 'number of commits to include', '100')
  .action(async (opts) => { await statsCommand(opts); });
program.parse();
