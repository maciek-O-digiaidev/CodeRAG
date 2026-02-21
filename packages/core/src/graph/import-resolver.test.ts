import { describe, it, expect } from 'vitest';
import { extractImports } from './import-resolver.js';

describe('extractImports', () => {
  describe('ES6 named imports', () => {
    it('should extract named imports', () => {
      const code = `import { foo, bar } from './module';`;
      const result = extractImports(code, 'typescript');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: './module',
          specifiers: ['foo', 'bar'],
          isDefault: false,
          isDynamic: false,
        }),
      );
    });

    it('should handle aliased named imports', () => {
      const code = `import { foo as f, bar as b } from './module';`;
      const result = extractImports(code, 'typescript');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: './module',
          specifiers: ['foo', 'bar'],
        }),
      );
    });

    it('should handle single named import', () => {
      const code = `import { Result } from 'neverthrow';`;
      const result = extractImports(code, 'typescript');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: 'neverthrow',
          specifiers: ['Result'],
          isDefault: false,
        }),
      );
    });
  });

  describe('ES6 default imports', () => {
    it('should extract default imports', () => {
      const code = `import React from 'react';`;
      const result = extractImports(code, 'javascript');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: 'react',
          specifiers: ['React'],
          isDefault: true,
          isDynamic: false,
        }),
      );
    });

    it('should not confuse default with type imports', () => {
      const code = `import type { Foo } from './types';`;
      const result = extractImports(code, 'typescript');

      // Should be captured as named, not default
      const defaultImports = result.filter((r) => r.isDefault);
      expect(defaultImports).toHaveLength(0);
    });
  });

  describe('TypeScript type imports', () => {
    it('should extract type-only imports', () => {
      const code = `import type { ParsedFile } from '../types/provider.js';`;
      const result = extractImports(code, 'typescript');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: '../types/provider.js',
          specifiers: ['ParsedFile'],
          isDefault: false,
        }),
      );
    });

    it('should handle multiple type imports', () => {
      const code = `import type { Chunk, ChunkMetadata } from './chunk.js';`;
      const result = extractImports(code, 'typescript');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: './chunk.js',
          specifiers: ['Chunk', 'ChunkMetadata'],
        }),
      );
    });
  });

  describe('default + named imports combo', () => {
    it('should extract default and named imports together', () => {
      const code = `import React, { useState, useEffect } from 'react';`;
      const result = extractImports(code, 'javascript');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: 'react',
          specifiers: ['React', 'useState', 'useEffect'],
          isDefault: true,
          isDynamic: false,
        }),
      );
    });
  });

  describe('side-effect imports', () => {
    it('should extract side-effect imports', () => {
      const code = `import './polyfill';`;
      const result = extractImports(code, 'javascript');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: './polyfill',
          specifiers: [],
          isDefault: false,
          isDynamic: false,
        }),
      );
    });

    it('should extract side-effect import with double quotes', () => {
      const code = `import "reflect-metadata";`;
      const result = extractImports(code, 'typescript');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: 'reflect-metadata',
          specifiers: [],
          isDefault: false,
        }),
      );
    });
  });

  describe('Python imports', () => {
    it('should extract simple Python imports', () => {
      const code = `import os`;
      const result = extractImports(code, 'python');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: 'os',
          specifiers: ['os'],
          isDefault: true,
        }),
      );
    });

    it('should extract from...import statements', () => {
      const code = `from os.path import join, dirname`;
      const result = extractImports(code, 'python');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: 'os.path',
          specifiers: ['join', 'dirname'],
          isDefault: false,
        }),
      );
    });

    it('should handle aliased Python imports', () => {
      const code = `import numpy as np`;
      const result = extractImports(code, 'python');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: 'numpy',
          specifiers: ['numpy'],
          isDefault: true,
        }),
      );
    });

    it('should handle from...import with alias', () => {
      const code = `from collections import OrderedDict as OD, defaultdict`;
      const result = extractImports(code, 'python');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: 'collections',
          specifiers: ['OrderedDict', 'defaultdict'],
        }),
      );
    });
  });

  describe('Go imports', () => {
    it('should extract single Go import', () => {
      const code = `import "fmt"`;
      const result = extractImports(code, 'go');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: 'fmt',
          specifiers: ['fmt'],
          isDefault: true,
        }),
      );
    });

    it('should extract Go import block', () => {
      const code = `
import (
  "fmt"
  "os"
  "path/filepath"
)`;
      const result = extractImports(code, 'go');

      expect(result).toContainEqual(
        expect.objectContaining({ source: 'fmt', specifiers: ['fmt'] }),
      );
      expect(result).toContainEqual(
        expect.objectContaining({ source: 'os', specifiers: ['os'] }),
      );
      expect(result).toContainEqual(
        expect.objectContaining({ source: 'path/filepath', specifiers: ['filepath'] }),
      );
    });

    it('should handle aliased Go imports', () => {
      const code = `
import (
  pb "github.com/example/proto"
)`;
      const result = extractImports(code, 'go');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: 'github.com/example/proto',
          specifiers: ['pb'],
        }),
      );
    });
  });

  describe('require() calls', () => {
    it('should extract require calls', () => {
      const code = `const fs = require('fs');`;
      const result = extractImports(code, 'javascript');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: 'fs',
          specifiers: [],
          isDynamic: false,
        }),
      );
    });

    it('should handle require with double quotes', () => {
      const code = `const path = require("path");`;
      const result = extractImports(code, 'javascript');

      expect(result).toContainEqual(
        expect.objectContaining({ source: 'path' }),
      );
    });
  });

  describe('dynamic import()', () => {
    it('should extract dynamic imports', () => {
      const code = `const mod = await import('./lazy-module');`;
      const result = extractImports(code, 'typescript');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: './lazy-module',
          specifiers: [],
          isDynamic: true,
        }),
      );
    });

    it('should extract dynamic import with double quotes', () => {
      const code = `const mod = import("./other");`;
      const result = extractImports(code, 'javascript');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: './other',
          isDynamic: true,
        }),
      );
    });
  });

  describe('re-exports', () => {
    it('should extract named re-exports', () => {
      const code = `export { foo, bar } from './module';`;
      const result = extractImports(code, 'typescript');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: './module',
          specifiers: ['foo', 'bar'],
          isDefault: false,
        }),
      );
    });

    it('should extract wildcard re-exports', () => {
      const code = `export * from './module';`;
      const result = extractImports(code, 'typescript');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: './module',
          specifiers: [],
          isDefault: false,
        }),
      );
    });

    it('should extract aliased re-exports', () => {
      const code = `export { default as Foo } from './foo';`;
      const result = extractImports(code, 'typescript');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: './foo',
          specifiers: ['default'],
        }),
      );
    });
  });

  describe('namespace imports', () => {
    it('should extract namespace imports', () => {
      const code = `import * as path from 'path';`;
      const result = extractImports(code, 'typescript');

      expect(result).toContainEqual(
        expect.objectContaining({
          source: 'path',
          specifiers: ['path'],
          isDefault: false,
        }),
      );
    });
  });

  describe('multiple imports in one file', () => {
    it('should extract all imports from a multi-import file', () => {
      const code = `
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { join } from 'node:path';
import type { ParsedFile } from '../types/provider.js';
export { GraphError } from './graph-builder.js';
`;
      const result = extractImports(code, 'typescript');

      const sources = result.map((r) => r.source);
      expect(sources).toContain('neverthrow');
      expect(sources).toContain('node:path');
      expect(sources).toContain('../types/provider.js');
      expect(sources).toContain('./graph-builder.js');
    });
  });

  describe('edge cases', () => {
    it('should return empty array for empty content', () => {
      expect(extractImports('', 'typescript')).toEqual([]);
    });

    it('should return empty array for content without imports', () => {
      const code = `const x = 42;\nconsole.log(x);`;
      expect(extractImports(code, 'typescript')).toEqual([]);
    });

    it('should use JS parser for unknown language', () => {
      const code = `import { foo } from './bar';`;
      const result = extractImports(code, 'rust');
      expect(result).toHaveLength(1);
      expect(result[0]?.source).toBe('./bar');
    });
  });
});
