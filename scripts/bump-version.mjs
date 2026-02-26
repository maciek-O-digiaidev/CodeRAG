#!/usr/bin/env node

/**
 * Bump version across all publishable packages, commit, tag, and push.
 *
 * Usage:
 *   node scripts/bump-version.mjs patch     # 0.1.10 → 0.1.11
 *   node scripts/bump-version.mjs minor     # 0.1.10 → 0.2.0
 *   node scripts/bump-version.mjs major     # 0.1.10 → 1.0.0
 *   node scripts/bump-version.mjs 0.2.0     # explicit version
 *
 * What it does:
 *   1. Reads current version from packages/core/package.json
 *   2. Computes new version based on bump type
 *   3. Updates version in all publishable package.json files
 *   4. Commits: "Bump all packages to <version>"
 *   5. Tags: v<version>
 *   6. Pushes commit + tag to both remotes (origin + github)
 *
 * Flags:
 *   --dry-run   Show what would happen without making changes
 *   --no-push   Commit and tag locally but don't push
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

/** Packages that get version bumps (all publishable + private that share version). */
const PACKAGES = [
  'packages/core',
  'packages/cli',
  'packages/mcp-server',
  'packages/api-server',
];

function readPkgJson(dir) {
  const path = join(ROOT, dir, 'package.json');
  return { path, data: JSON.parse(readFileSync(path, 'utf-8')) };
}

function writePkgJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split('.').map(Number);
  switch (type) {
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'major': return `${major + 1}.0.0`;
    default: {
      // Treat as explicit version
      if (/^\d+\.\d+\.\d+/.test(type)) return type;
      console.error(`Unknown bump type: ${type}`);
      console.error('Usage: node scripts/bump-version.mjs patch|minor|major|<version>');
      process.exit(1);
    }
  }
}

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe', ...opts }).trim();
}

function hasRemote(name) {
  try {
    run(`git remote get-url ${name}`);
    return true;
  } catch {
    return false;
  }
}

// --- Main ---

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const dryRun = flags.has('--dry-run');
const noPush = flags.has('--no-push');

if (args.length === 0) {
  console.error('Usage: node scripts/bump-version.mjs patch|minor|major|<version> [--dry-run] [--no-push]');
  process.exit(1);
}

// 1. Read current version
const { data: corePkg } = readPkgJson('packages/core');
const currentVersion = corePkg.version;
const newVersion = bumpVersion(currentVersion, args[0]);

console.log(`Version: ${currentVersion} → ${newVersion}`);

if (dryRun) {
  console.log('\n[dry-run] Would update:');
  for (const dir of PACKAGES) {
    console.log(`  ${dir}/package.json`);
  }
  console.log(`\n[dry-run] Would commit: "Bump all packages to ${newVersion}"`);
  console.log(`[dry-run] Would tag: v${newVersion}`);
  console.log('[dry-run] Would push to: origin, github');
  process.exit(0);
}

// 2. Check working tree is clean
const status = run('git status --porcelain');
if (status.length > 0) {
  console.error('\nWorking tree is not clean. Commit or stash changes first.');
  console.error(status);
  process.exit(1);
}

// 3. Check tag doesn't already exist
try {
  run(`git rev-parse v${newVersion}`);
  console.error(`\nTag v${newVersion} already exists. Choose a different version.`);
  process.exit(1);
} catch {
  // Tag doesn't exist — good
}

// 4. Update all package.json files
const updatedFiles = [];
for (const dir of PACKAGES) {
  const { path, data } = readPkgJson(dir);
  data.version = newVersion;
  writePkgJson(path, data);
  updatedFiles.push(`${dir}/package.json`);
  console.log(`  Updated ${dir}/package.json`);
}

// 5. Commit
const fileArgs = updatedFiles.join(' ');
run(`git add ${fileArgs}`);
run(`git commit -m "Bump all packages to ${newVersion}"`);
console.log(`\nCommitted: Bump all packages to ${newVersion}`);

// 6. Tag
run(`git tag v${newVersion}`);
console.log(`Tagged: v${newVersion}`);

// 7. Push
if (noPush) {
  console.log('\n--no-push: skipping push. Run manually:');
  console.log(`  git push origin main && git push origin v${newVersion}`);
  if (hasRemote('github')) {
    console.log(`  git push github main && git push github v${newVersion}`);
  }
} else {
  const remotes = ['origin'];
  if (hasRemote('github')) remotes.push('github');

  for (const remote of remotes) {
    run(`git push ${remote} main`);
    run(`git push ${remote} v${newVersion}`);
    console.log(`Pushed to ${remote}`);
  }
  console.log(`\nDone! v${newVersion} released.`);
  console.log('GitHub Actions will now build, test, and publish to npm + ghcr.io.');
}
