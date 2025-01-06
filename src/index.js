#!/usr/bin/env node
import { program } from 'commander';

program
  .name('git-shrink')
  .version('0.1.0')
  .description('git history squash tool');

program
  .command('analyze')
  .description('analyze commit history')
  .action(() => {
    console.log('todo');
  });

program.parse();
