#!/usr/bin/env node

/**
 * Pre-publish validation script for CodeRAG packages.
 *
 * Validates that each publishable package:
 * 1. Has required package.json fields (name, version, description, license, etc.)
 * 2. Produces a clean tarball via `npm pack --dry-run`
 * 3. Tarball is within size limits
 * 4. No test files or source maps are included
 * 5. Binary entry point is configured for CLI
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

/** @type {Array<{ name: string; dir: string; maxSizeKB: number }>} */
const PUBLISHABLE_PACKAGES = [
  { name: '@code-rag/core', dir: 'packages/core', maxSizeKB: 500 },
  { name: '@code-rag/cli', dir: 'packages/cli', maxSizeKB: 200 },
  { name: '@code-rag/mcp-server', dir: 'packages/mcp-server', maxSizeKB: 200 },
  { name: '@code-rag/api-server', dir: 'packages/api-server', maxSizeKB: 200 },
];

const REQUIRED_FIELDS = [
  'name',
  'version',
  'description',
  'license',
  'author',
  'repository',
  'homepage',
  'bugs',
  'engines',
  'keywords',
  'files',
];

const FORBIDDEN_PATTERNS = [
  /\.test\.(js|ts|d\.ts)$/,
  /\.spec\.(js|ts|d\.ts)$/,
  /\.map$/,
  /__tests__\//,
  /\.test\.js\.map$/,
  /tsconfig\.json$/,
  /vitest\.config/,
  /\.eslintrc/,
];

let exitCode = 0;

function logError(msg) {
  console.error(`  ERROR: ${msg}`);
  exitCode = 1;
}

function logOk(msg) {
  console.log(`  OK: ${msg}`);
}

function logSection(msg) {
  console.log(`\n--- ${msg} ---`);
}

// Check that build output exists
function checkBuildExists(pkgDir) {
  const distDir = join(pkgDir, 'dist');
  if (!existsSync(distDir)) {
    logError(`dist/ directory not found at ${distDir}. Run 'pnpm build' first.`);
    return false;
  }
  return true;
}

// Validate package.json fields
function validatePackageJson(pkgDir, pkgName) {
  const pkgJsonPath = join(pkgDir, 'package.json');
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));

  for (const field of REQUIRED_FIELDS) {
    if (pkgJson[field] === undefined || pkgJson[field] === null) {
      logError(`${pkgName}: missing required field '${field}'`);
    }
  }

  if (pkgJson.private === true) {
    logError(`${pkgName}: package is marked as private`);
  }

  if (pkgName === '@code-rag/cli') {
    if (!pkgJson.bin || !pkgJson.bin.coderag) {
      logError(`${pkgName}: missing bin.coderag entry`);
    } else {
      logOk(`${pkgName}: bin entry configured (${pkgJson.bin.coderag})`);
    }
  }

  // Check files field doesn't include test patterns
  if (Array.isArray(pkgJson.files)) {
    const hasTests = pkgJson.files.some(
      (f) => f.includes('test') || f.includes('spec') || f === 'src'
    );
    if (hasTests) {
      logError(`${pkgName}: files field includes test/source entries`);
    }
  }

  logOk(`${pkgName}: package.json fields validated`);
}

// Run npm pack --dry-run and check output
function checkPackContents(pkgDir, pkgName, maxSizeKB) {
  try {
    const output = execSync('npm pack --dry-run --json 2>/dev/null', {
      cwd: pkgDir,
      encoding: 'utf-8',
      timeout: 30000,
    });

    let packInfo;
    try {
      packInfo = JSON.parse(output);
    } catch {
      // npm pack --dry-run --json may output lines before JSON; try extracting
      const jsonMatch = output.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        packInfo = JSON.parse(jsonMatch[0]);
      } else {
        logError(`${pkgName}: could not parse npm pack --dry-run --json output`);
        return;
      }
    }

    const info = Array.isArray(packInfo) ? packInfo[0] : packInfo;
    const sizeBytes = info.size || 0;
    const sizeKB = Math.round(sizeBytes / 1024);
    const fileCount = info.files ? info.files.length : 0;

    if (sizeKB > maxSizeKB) {
      logError(
        `${pkgName}: tarball size ${sizeKB}KB exceeds limit of ${maxSizeKB}KB`
      );
    } else {
      logOk(`${pkgName}: tarball size ${sizeKB}KB (limit: ${maxSizeKB}KB)`);
    }

    logOk(`${pkgName}: ${fileCount} files in tarball`);

    // Check for forbidden files
    if (info.files) {
      for (const file of info.files) {
        const filePath = file.path || file;
        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.test(filePath)) {
            logError(
              `${pkgName}: forbidden file in tarball: ${filePath} (matches ${pattern})`
            );
          }
        }
      }
    }
  } catch (err) {
    // npm pack --dry-run without --json as fallback
    try {
      const output = execSync('npm pack --dry-run 2>&1', {
        cwd: pkgDir,
        encoding: 'utf-8',
        timeout: 30000,
      });
      console.log(`  ${pkgName}: npm pack --dry-run output:\n${output}`);

      // Check for forbidden patterns in output
      const lines = output.split('\n');
      for (const line of lines) {
        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            logError(
              `${pkgName}: forbidden file in tarball: ${line.trim()}`
            );
          }
        }
      }
      logOk(`${pkgName}: npm pack --dry-run completed (no JSON parsing)`);
    } catch (fallbackErr) {
      logError(`${pkgName}: npm pack --dry-run failed: ${fallbackErr.message}`);
    }
  }
}

// Main
console.log('=== CodeRAG Pre-Publish Validation ===');
console.log(`Root: ${ROOT}`);

for (const pkg of PUBLISHABLE_PACKAGES) {
  const pkgDir = join(ROOT, pkg.dir);

  logSection(`Validating ${pkg.name}`);

  if (!existsSync(pkgDir)) {
    logError(`${pkg.name}: package directory not found at ${pkgDir}`);
    continue;
  }

  validatePackageJson(pkgDir, pkg.name);

  if (checkBuildExists(pkgDir)) {
    checkPackContents(pkgDir, pkg.name, pkg.maxSizeKB);
  }
}

logSection('Summary');
if (exitCode === 0) {
  console.log('All checks passed!');
} else {
  console.log('Some checks failed. Please fix the errors above.');
}

process.exit(exitCode);
