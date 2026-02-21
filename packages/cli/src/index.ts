#!/usr/bin/env node
import { Command } from 'commander';
import { registerInitCommand } from './commands/init.js';
import { registerIndexCommand } from './commands/index-cmd.js';
import { registerSearchCommand } from './commands/search.js';
import { registerServeCommand } from './commands/serve.js';
import { registerStatusCommand } from './commands/status.js';

const program = new Command();
program
  .name('coderag')
  .description('CodeRAG — intelligent codebase context engine for AI coding agents')
  .version('0.1.0');

registerInitCommand(program);
registerIndexCommand(program);
registerSearchCommand(program);
registerServeCommand(program);
registerStatusCommand(program);

program.parse();
