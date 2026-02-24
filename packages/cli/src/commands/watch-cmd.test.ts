import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { registerWatchCommand } from './watch-cmd.js';

describe('registerWatchCommand', () => {
  it('should register a watch command on the program', () => {
    const program = new Command();
    registerWatchCommand(program);

    const watchCmd = program.commands.find((c) => c.name() === 'watch');
    expect(watchCmd).toBeDefined();
    expect(watchCmd!.description()).toContain('Watch');
  });

  it('should have a --debounce option with default 2000', () => {
    const program = new Command();
    registerWatchCommand(program);

    const watchCmd = program.commands.find((c) => c.name() === 'watch');
    const debounceOpt = watchCmd!.options.find((o) => o.long === '--debounce');
    expect(debounceOpt).toBeDefined();
    expect(debounceOpt!.defaultValue).toBe('2000');
  });
});
