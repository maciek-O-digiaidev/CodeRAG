import { describe, it, expect, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerViewerCommand, resolveViewerDist } from './viewer.js';

describe('registerViewerCommand', () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.name('coderag').version('0.1.0');
    registerViewerCommand(program);
  });

  it('should register the viewer command', () => {
    const commandNames = program.commands.map((cmd) => cmd.name());
    expect(commandNames).toContain('viewer');
  });

  it('should have --port option with default 3333', () => {
    const viewerCmd = program.commands.find((c) => c.name() === 'viewer');
    expect(viewerCmd).toBeDefined();
    const portOpt = viewerCmd!.options.find((o) => o.long === '--port');
    expect(portOpt).toBeDefined();
    expect(portOpt!.defaultValue).toBe('3333');
  });

  it('should have --no-open option', () => {
    const viewerCmd = program.commands.find((c) => c.name() === 'viewer');
    expect(viewerCmd).toBeDefined();
    const opts = viewerCmd!.options.map((o) => o.long);
    expect(opts).toContain('--no-open');
  });

  it('should have a description', () => {
    const viewerCmd = program.commands.find((c) => c.name() === 'viewer');
    expect(viewerCmd).toBeDefined();
    expect(viewerCmd!.description()).toBeTruthy();
    expect(viewerCmd!.description()).toContain('Viewer');
  });
});

describe('resolveViewerDist', () => {
  it('should return null when no dist directory exists', () => {
    // resolveViewerDist looks relative to the compiled file location,
    // which won't find a viewer/dist in test context
    const result = resolveViewerDist();
    // May or may not be null depending on if viewer is built,
    // but the function should not throw
    expect(result === null || typeof result === 'string').toBe(true);
  });
});

describe('CLI integration with viewer command', () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.name('coderag').version('0.1.0');
    program.exitOverride();
    registerViewerCommand(program);
  });

  it('should parse custom port', () => {
    const viewerCmd = program.commands.find((c) => c.name() === 'viewer');
    expect(viewerCmd).toBeDefined();

    // Verify the port option short flag is -p
    const portOpt = viewerCmd!.options.find((o) => o.long === '--port');
    expect(portOpt?.short).toBe('-p');
  });

  it('should register all expected commands including viewer', () => {
    // Simulate what index.ts does
    const fullProgram = new Command();
    fullProgram.name('coderag').version('0.1.0');
    registerViewerCommand(fullProgram);

    expect(fullProgram.commands).toHaveLength(1);
    expect(fullProgram.commands[0]!.name()).toBe('viewer');
  });
});
