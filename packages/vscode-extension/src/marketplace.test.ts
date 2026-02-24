/**
 * Tests for VS Code Marketplace publishing readiness.
 *
 * Validates that the extension manifest, .vscodeignore, README, and CHANGELOG
 * are correctly configured for publishing to the VS Code Marketplace.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = resolve(THIS_DIR, '..');

function readJson(filePath: string): Record<string, unknown> {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function readText(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

describe('Marketplace: package.json manifest', () => {
  const pkgPath = resolve(EXT_ROOT, 'package.json');
  const pkg = readJson(pkgPath);

  it('has a publisher field', () => {
    expect(pkg['publisher']).toBe('coderag');
  });

  it('has a displayName', () => {
    expect(pkg['displayName']).toBe('CodeRAG');
  });

  it('has a non-empty description', () => {
    expect(typeof pkg['description']).toBe('string');
    expect((pkg['description'] as string).length).toBeGreaterThan(20);
  });

  it('has a version in semver format', () => {
    const version = pkg['version'] as string;
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('has an icon path pointing to images/icon.png', () => {
    expect(pkg['icon']).toBe('images/icon.png');
  });

  it('has the icon file on disk', () => {
    const iconPath = resolve(EXT_ROOT, 'images', 'icon.png');
    expect(existsSync(iconPath)).toBe(true);
  });

  it('icon file is a valid PNG (starts with PNG signature)', () => {
    const iconPath = resolve(EXT_ROOT, 'images', 'icon.png');
    const buffer = readFileSync(iconPath);
    // PNG magic bytes: 0x89 0x50 0x4E 0x47
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50); // P
    expect(buffer[2]).toBe(0x4e); // N
    expect(buffer[3]).toBe(0x47); // G
  });

  it('has categories including Programming Languages', () => {
    const categories = pkg['categories'] as string[];
    expect(Array.isArray(categories)).toBe(true);
    expect(categories).toContain('Programming Languages');
  });

  it('has at least 5 keywords for discoverability', () => {
    const keywords = pkg['keywords'] as string[];
    expect(Array.isArray(keywords)).toBe(true);
    expect(keywords.length).toBeGreaterThanOrEqual(5);
  });

  it('has keywords including mcp and semantic-search', () => {
    const keywords = pkg['keywords'] as string[];
    expect(keywords).toContain('mcp');
    expect(keywords).toContain('semantic-search');
  });

  it('has a galleryBanner with color and theme', () => {
    const banner = pkg['galleryBanner'] as Record<string, string>;
    expect(banner).toBeDefined();
    expect(banner['color']).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(banner['theme']).toMatch(/^(dark|light)$/);
  });

  it('has repository URL', () => {
    const repo = pkg['repository'] as Record<string, string>;
    expect(repo).toBeDefined();
    expect(repo['url']).toContain('CodeRAG');
  });

  it('has homepage URL', () => {
    expect(typeof pkg['homepage']).toBe('string');
    expect((pkg['homepage'] as string).length).toBeGreaterThan(0);
  });

  it('has bugs URL', () => {
    const bugs = pkg['bugs'] as Record<string, string>;
    expect(bugs).toBeDefined();
    expect(bugs['url']).toBeDefined();
  });

  it('has a vscode:prepublish script', () => {
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['vscode:prepublish']).toBeDefined();
    expect(scripts['vscode:prepublish']).toContain('esbuild');
    expect(scripts['vscode:prepublish']).toContain('--minify');
  });

  it('has engines.vscode defined', () => {
    const engines = pkg['engines'] as Record<string, string>;
    expect(engines['vscode']).toBeDefined();
    expect(engines['vscode']).toMatch(/^\^1\.\d+\.\d+$/);
  });

  it('has main entry point set to dist/extension.js', () => {
    expect(pkg['main']).toBe('./dist/extension.js');
  });

  it('has preview flag set to true for initial release', () => {
    expect(pkg['preview']).toBe(true);
  });
});

describe('Marketplace: .vscodeignore', () => {
  const ignorePath = resolve(EXT_ROOT, '.vscodeignore');

  it('file exists', () => {
    expect(existsSync(ignorePath)).toBe(true);
  });

  it('excludes src/ directory (source files are bundled)', () => {
    const content = readText(ignorePath);
    expect(content).toContain('src/**');
  });

  it('excludes test configuration', () => {
    const content = readText(ignorePath);
    expect(content).toContain('vitest.config.ts');
  });

  it('excludes tsconfig.json', () => {
    const content = readText(ignorePath);
    expect(content).toContain('tsconfig.json');
  });

  it('excludes node_modules', () => {
    const content = readText(ignorePath);
    expect(content).toContain('node_modules/**');
  });

  it('excludes source maps', () => {
    const content = readText(ignorePath);
    expect(content).toContain('dist/**/*.map');
  });

  it('excludes .vsix files', () => {
    const content = readText(ignorePath);
    expect(content).toContain('*.vsix');
  });

  it('excludes coverage directory', () => {
    const content = readText(ignorePath);
    expect(content).toContain('coverage/**');
  });
});

describe('Marketplace: README.md', () => {
  const readmePath = resolve(EXT_ROOT, 'README.md');

  it('file exists', () => {
    expect(existsSync(readmePath)).toBe(true);
  });

  it('has a title', () => {
    const content = readText(readmePath);
    expect(content).toMatch(/^# CodeRAG/m);
  });

  it('has a Features section', () => {
    const content = readText(readmePath);
    expect(content).toContain('## Features');
  });

  it('has a Requirements section', () => {
    const content = readText(readmePath);
    expect(content).toContain('## Requirements');
  });

  it('has a Quick Start section', () => {
    const content = readText(readmePath);
    expect(content).toContain('## Quick Start');
  });

  it('has a Commands section', () => {
    const content = readText(readmePath);
    expect(content).toContain('## Commands');
  });

  it('has a Configuration section', () => {
    const content = readText(readmePath);
    expect(content).toContain('## Configuration');
  });

  it('mentions all registered commands', () => {
    const content = readText(readmePath);
    expect(content).toContain('CodeRAG: Search');
    expect(content).toContain('CodeRAG: Index');
    expect(content).toContain('CodeRAG: Status');
    expect(content).toContain('CodeRAG: Configure Claude Code');
  });

  it('mentions the coderag.autoConfigureClaude setting', () => {
    const content = readText(readmePath);
    expect(content).toContain('coderag.autoConfigureClaude');
  });

  it('has a Known Issues section', () => {
    const content = readText(readmePath);
    expect(content).toContain('## Known Issues');
  });

  it('has a Privacy section', () => {
    const content = readText(readmePath);
    expect(content).toContain('## Privacy');
    expect(content).toContain('local-first');
  });

  it('is at least 1000 characters (substantive content)', () => {
    const content = readText(readmePath);
    expect(content.length).toBeGreaterThan(1000);
  });
});

describe('Marketplace: CHANGELOG.md', () => {
  const changelogPath = resolve(EXT_ROOT, 'CHANGELOG.md');

  it('file exists', () => {
    expect(existsSync(changelogPath)).toBe(true);
  });

  it('has a Changelog title', () => {
    const content = readText(changelogPath);
    expect(content).toMatch(/^# Changelog/m);
  });

  it('follows Keep a Changelog format with reference link', () => {
    const content = readText(changelogPath);
    expect(content).toContain('Keep a Changelog');
  });

  it('references Semantic Versioning', () => {
    const content = readText(changelogPath);
    expect(content).toContain('Semantic Versioning');
  });

  it('has an Unreleased section', () => {
    const content = readText(changelogPath);
    expect(content).toMatch(/## \[Unreleased\]/);
  });

  it('has a 0.1.0 release entry', () => {
    const content = readText(changelogPath);
    expect(content).toMatch(/## \[0\.1\.0\]/);
  });

  it('has an Added subsection in 0.1.0', () => {
    const content = readText(changelogPath);
    expect(content).toContain('### Added');
  });

  it('lists Search Panel as an added feature', () => {
    const content = readText(changelogPath);
    expect(content).toContain('Search Panel');
  });

  it('lists MCP Server integration as an added feature', () => {
    const content = readText(changelogPath);
    expect(content).toContain('MCP Server integration');
  });
});

describe('Marketplace: GitHub Actions workflow', () => {
  const workflowPath = resolve(EXT_ROOT, '..', '..', '.github', 'workflows', 'vscode-publish.yml');

  it('workflow file exists', () => {
    expect(existsSync(workflowPath)).toBe(true);
  });

  it('triggers on vscode-v* tags', () => {
    const content = readText(workflowPath);
    expect(content).toContain("'vscode-v*'");
  });

  it('uses checkout action', () => {
    const content = readText(workflowPath);
    expect(content).toContain('actions/checkout@v4');
  });

  it('uses Node.js setup', () => {
    const content = readText(workflowPath);
    expect(content).toContain('actions/setup-node@v4');
  });

  it('uses pnpm setup', () => {
    const content = readText(workflowPath);
    expect(content).toContain('pnpm/action-setup@v4');
  });

  it('runs tests before publishing', () => {
    const content = readText(workflowPath);
    // Match step names specifically (prefixed by "name: ")
    const testIndex = content.indexOf('name: Run tests');
    const publishIndex = content.indexOf('name: Publish to VS Code Marketplace');
    expect(testIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(-1);
    expect(testIndex).toBeLessThan(publishIndex);
  });

  it('runs vsce publish with PAT secret', () => {
    const content = readText(workflowPath);
    expect(content).toContain('vsce publish');
    expect(content).toContain('VSCE_PAT');
  });

  it('uploads VSIX as artifact', () => {
    const content = readText(workflowPath);
    expect(content).toContain('actions/upload-artifact@v4');
    expect(content).toContain('*.vsix');
  });
});
