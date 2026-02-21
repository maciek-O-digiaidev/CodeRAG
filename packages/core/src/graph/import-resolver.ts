export interface ImportInfo {
  source: string;
  specifiers: string[];
  isDefault: boolean;
  isDynamic: boolean;
}

/**
 * Extract import statements from source code using regex patterns.
 * Supports ES6/TypeScript, Python, Go, and CommonJS require().
 */
export function extractImports(content: string, language: string): ImportInfo[] {
  switch (language) {
    case 'typescript':
    case 'tsx':
    case 'javascript':
    case 'jsx':
      return extractJSImports(content);
    case 'python':
      return extractPythonImports(content);
    case 'go':
      return extractGoImports(content);
    default:
      return extractJSImports(content);
  }
}

function extractJSImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // ES6 named imports: import { a, b } from 'module'
  // Also handles type-only: import type { a } from 'module'
  const namedImportRe =
    /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = namedImportRe.exec(content)) !== null) {
    const specifiers = match[1]!
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0]!.trim())
      .filter((s) => s.length > 0);
    imports.push({
      source: match[2]!,
      specifiers,
      isDefault: false,
      isDynamic: false,
    });
  }

  // ES6 default import: import Foo from 'module'
  // Avoid matching "import type", "import {", "import *"
  const defaultImportRe =
    /import\s+(?!type\b)(?!\{)(?!\*)([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = defaultImportRe.exec(content)) !== null) {
    imports.push({
      source: match[2]!,
      specifiers: [match[1]!],
      isDefault: true,
      isDynamic: false,
    });
  }

  // ES6 default + named: import Foo, { bar } from 'module'
  const defaultAndNamedRe =
    /import\s+([A-Za-z_$][\w$]*)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = defaultAndNamedRe.exec(content)) !== null) {
    const specifiers = match[2]!
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0]!.trim())
      .filter((s) => s.length > 0);
    imports.push({
      source: match[3]!,
      specifiers: [match[1]!, ...specifiers],
      isDefault: true,
      isDynamic: false,
    });
  }

  // Namespace import: import * as ns from 'module'
  const namespaceRe = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = namespaceRe.exec(content)) !== null) {
    imports.push({
      source: match[2]!,
      specifiers: [match[1]!],
      isDefault: false,
      isDynamic: false,
    });
  }

  // Side-effect import: import 'module'
  const sideEffectRe = /import\s+['"]([^'"]+)['"]/g;
  while ((match = sideEffectRe.exec(content)) !== null) {
    // Skip if this is part of a longer import already captured
    const full = match[0]!;
    if (!full.includes('from')) {
      imports.push({
        source: match[1]!,
        specifiers: [],
        isDefault: false,
        isDynamic: false,
      });
    }
  }

  // Dynamic import: import('module')
  const dynamicImportRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRe.exec(content)) !== null) {
    imports.push({
      source: match[1]!,
      specifiers: [],
      isDefault: false,
      isDynamic: true,
    });
  }

  // require() calls: const x = require('module')
  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRe.exec(content)) !== null) {
    imports.push({
      source: match[1]!,
      specifiers: [],
      isDefault: false,
      isDynamic: false,
    });
  }

  // Re-exports: export { a, b } from 'module'
  const reExportRe = /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = reExportRe.exec(content)) !== null) {
    const specifiers = match[1]!
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0]!.trim())
      .filter((s) => s.length > 0);
    imports.push({
      source: match[2]!,
      specifiers,
      isDefault: false,
      isDynamic: false,
    });
  }

  // Re-export all: export * from 'module'
  const reExportAllRe = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = reExportAllRe.exec(content)) !== null) {
    imports.push({
      source: match[1]!,
      specifiers: [],
      isDefault: false,
      isDynamic: false,
    });
  }

  return imports;
}

function extractPythonImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  let match: RegExpExecArray | null;

  // from module import a, b, c
  const fromImportRe = /from\s+([\w.]+)\s+import\s+([^(\n]+)/g;
  while ((match = fromImportRe.exec(content)) !== null) {
    const specifiers = match[2]!
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0]!.trim())
      .filter((s) => s.length > 0);
    imports.push({
      source: match[1]!,
      specifiers,
      isDefault: false,
      isDynamic: false,
    });
  }

  // import module (possibly with alias)
  // Must not match "from ... import ..."
  const simpleImportRe = /^import\s+([\w.]+)(?:\s+as\s+\w+)?/gm;
  while ((match = simpleImportRe.exec(content)) !== null) {
    imports.push({
      source: match[1]!,
      specifiers: [match[1]!],
      isDefault: true,
      isDynamic: false,
    });
  }

  return imports;
}

function extractGoImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  let match: RegExpExecArray | null;

  // Single import: import "fmt"
  const singleImportRe = /import\s+"([^"]+)"/g;
  while ((match = singleImportRe.exec(content)) !== null) {
    const source = match[1]!;
    const parts = source.split('/');
    const specifier = parts[parts.length - 1]!;
    imports.push({
      source,
      specifiers: [specifier],
      isDefault: true,
      isDynamic: false,
    });
  }

  // Import block: import ( ... )
  const blockImportRe = /import\s*\(([\s\S]*?)\)/g;
  while ((match = blockImportRe.exec(content)) !== null) {
    const block = match[1]!;
    const lineRe = /(?:(\w+)\s+)?"([^"]+)"/g;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRe.exec(block)) !== null) {
      const source = lineMatch[2]!;
      const parts = source.split('/');
      const alias = lineMatch[1];
      const specifier = alias ?? parts[parts.length - 1]!;
      imports.push({
        source,
        specifiers: [specifier],
        isDefault: true,
        isDynamic: false,
      });
    }
  }

  return imports;
}
