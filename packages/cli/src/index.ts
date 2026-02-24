#!/usr/bin/env node
import { Command } from 'commander';
import { registerInitCommand } from './commands/init.js';
import { registerIndexCommand } from './commands/index-cmd.js';
import { registerSearchCommand } from './commands/search.js';
import { registerServeCommand } from './commands/serve.js';
import { registerStatusCommand } from './commands/status.js';
import { registerViewerCommand } from './commands/viewer.js';
import { registerWatchCommand } from './commands/watch-cmd.js';
import { registerHooksCommand } from './commands/hooks-cmd.js';

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
registerViewerCommand(program);
registerWatchCommand(program);
registerHooksCommand(program);

program.parse();
