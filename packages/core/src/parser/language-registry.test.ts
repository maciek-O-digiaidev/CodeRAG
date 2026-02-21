import { describe, it, expect } from 'vitest';
import {
  LanguageRegistry,
  EXTENSION_TO_LANGUAGE,
  LANGUAGE_TO_WASM,
  DECLARATION_NODE_TYPES,
  type SupportedLanguage,
} from './language-registry.js';

describe('LanguageRegistry', () => {
  const registry = new LanguageRegistry();

  describe('detectLanguage', () => {
    it('should detect JavaScript from .js extension', () => {
      expect(registry.detectLanguage('app.js')).toBe('javascript');
    });

    it('should detect JavaScript from .jsx extension', () => {
      expect(registry.detectLanguage('Component.jsx')).toBe('javascript');
    });

    it('should detect JavaScript from .mjs extension', () => {
      expect(registry.detectLanguage('module.mjs')).toBe('javascript');
    });

    it('should detect JavaScript from .cjs extension', () => {
      expect(registry.detectLanguage('config.cjs')).toBe('javascript');
    });

    it('should detect TypeScript from .ts extension', () => {
      expect(registry.detectLanguage('index.ts')).toBe('typescript');
    });

    it('should detect TypeScript from .mts extension', () => {
      expect(registry.detectLanguage('module.mts')).toBe('typescript');
    });

    it('should detect TypeScript from .cts extension', () => {
      expect(registry.detectLanguage('config.cts')).toBe('typescript');
    });

    it('should detect TSX from .tsx extension', () => {
      expect(registry.detectLanguage('App.tsx')).toBe('tsx');
    });

    it('should detect Python from .py extension', () => {
      expect(registry.detectLanguage('main.py')).toBe('python');
    });

    it('should detect Python from .pyw extension', () => {
      expect(registry.detectLanguage('gui.pyw')).toBe('python');
    });

    it('should detect Go from .go extension', () => {
      expect(registry.detectLanguage('main.go')).toBe('go');
    });

    it('should detect Rust from .rs extension', () => {
      expect(registry.detectLanguage('lib.rs')).toBe('rust');
    });

    it('should detect Java from .java extension', () => {
      expect(registry.detectLanguage('Main.java')).toBe('java');
    });

    it('should detect C# from .cs extension', () => {
      expect(registry.detectLanguage('Program.cs')).toBe('c_sharp');
    });

    it('should detect C from .c extension', () => {
      expect(registry.detectLanguage('main.c')).toBe('c');
    });

    it('should detect C from .h extension', () => {
      expect(registry.detectLanguage('header.h')).toBe('c');
    });

    it('should detect C++ from .cpp extension', () => {
      expect(registry.detectLanguage('main.cpp')).toBe('cpp');
    });

    it('should detect C++ from .cc extension', () => {
      expect(registry.detectLanguage('main.cc')).toBe('cpp');
    });

    it('should detect C++ from .cxx extension', () => {
      expect(registry.detectLanguage('main.cxx')).toBe('cpp');
    });

    it('should detect C++ from .hpp extension', () => {
      expect(registry.detectLanguage('header.hpp')).toBe('cpp');
    });

    it('should detect C++ from .hxx extension', () => {
      expect(registry.detectLanguage('header.hxx')).toBe('cpp');
    });

    it('should detect Ruby from .rb extension', () => {
      expect(registry.detectLanguage('app.rb')).toBe('ruby');
    });

    it('should detect PHP from .php extension', () => {
      expect(registry.detectLanguage('index.php')).toBe('php');
    });

    it('should return undefined for unknown extensions', () => {
      expect(registry.detectLanguage('data.json')).toBeUndefined();
    });

    it('should return undefined for files without extensions', () => {
      expect(registry.detectLanguage('Makefile')).toBeUndefined();
    });

    it('should return undefined for .txt files', () => {
      expect(registry.detectLanguage('readme.txt')).toBeUndefined();
    });

    it('should handle file paths with directories', () => {
      expect(registry.detectLanguage('src/utils/helper.ts')).toBe('typescript');
    });

    it('should handle case-insensitive extensions', () => {
      expect(registry.detectLanguage('main.PY')).toBe('python');
    });
  });

  describe('supportedLanguages', () => {
    it('should return all 12 supported languages', () => {
      const languages = registry.supportedLanguages();
      expect(languages).toHaveLength(12);
    });

    it('should include all expected languages', () => {
      const languages = new Set(registry.supportedLanguages());
      const expected: SupportedLanguage[] = [
        'javascript',
        'typescript',
        'tsx',
        'python',
        'go',
        'rust',
        'java',
        'c_sharp',
        'c',
        'cpp',
        'ruby',
        'php',
      ];
      for (const lang of expected) {
        expect(languages.has(lang)).toBe(true);
      }
    });
  });

  describe('getDeclarationNodeTypes', () => {
    it('should return a non-empty Set for JavaScript', () => {
      const types = registry.getDeclarationNodeTypes('javascript');
      expect(types.size).toBeGreaterThan(0);
      expect(types.has('function_declaration')).toBe(true);
      expect(types.has('class_declaration')).toBe(true);
    });

    it('should return a non-empty Set for TypeScript', () => {
      const types = registry.getDeclarationNodeTypes('typescript');
      expect(types.size).toBeGreaterThan(0);
      expect(types.has('interface_declaration')).toBe(true);
      expect(types.has('type_alias_declaration')).toBe(true);
    });

    it('should return a non-empty Set for Python', () => {
      const types = registry.getDeclarationNodeTypes('python');
      expect(types.size).toBeGreaterThan(0);
      expect(types.has('function_definition')).toBe(true);
      expect(types.has('class_definition')).toBe(true);
    });

    it('should return a non-empty Set for Go', () => {
      const types = registry.getDeclarationNodeTypes('go');
      expect(types.size).toBeGreaterThan(0);
      expect(types.has('function_declaration')).toBe(true);
    });

    it('should return a non-empty Set for Rust', () => {
      const types = registry.getDeclarationNodeTypes('rust');
      expect(types.size).toBeGreaterThan(0);
      expect(types.has('function_item')).toBe(true);
      expect(types.has('struct_item')).toBe(true);
    });

    it('should return a non-empty Set for Java', () => {
      const types = registry.getDeclarationNodeTypes('java');
      expect(types.size).toBeGreaterThan(0);
      expect(types.has('class_declaration')).toBe(true);
    });

    it('should return a non-empty Set for C#', () => {
      const types = registry.getDeclarationNodeTypes('c_sharp');
      expect(types.size).toBeGreaterThan(0);
      expect(types.has('class_declaration')).toBe(true);
    });

    it('should return a non-empty Set for C', () => {
      const types = registry.getDeclarationNodeTypes('c');
      expect(types.size).toBeGreaterThan(0);
      expect(types.has('function_definition')).toBe(true);
    });

    it('should return a non-empty Set for C++', () => {
      const types = registry.getDeclarationNodeTypes('cpp');
      expect(types.size).toBeGreaterThan(0);
      expect(types.has('function_definition')).toBe(true);
      expect(types.has('class_specifier')).toBe(true);
    });

    it('should return a non-empty Set for Ruby', () => {
      const types = registry.getDeclarationNodeTypes('ruby');
      expect(types.size).toBeGreaterThan(0);
      expect(types.has('method')).toBe(true);
      expect(types.has('class')).toBe(true);
    });

    it('should return a non-empty Set for PHP', () => {
      const types = registry.getDeclarationNodeTypes('php');
      expect(types.size).toBeGreaterThan(0);
      expect(types.has('function_definition')).toBe(true);
      expect(types.has('class_declaration')).toBe(true);
    });

    it('should return declaration types for all supported languages', () => {
      for (const lang of registry.supportedLanguages()) {
        const types = registry.getDeclarationNodeTypes(lang as SupportedLanguage);
        expect(types.size).toBeGreaterThan(0);
      }
    });
  });

  describe('EXTENSION_TO_LANGUAGE map', () => {
    it('should have entries for all documented extensions', () => {
      const expectedExtensions = [
        '.js', '.jsx', '.mjs', '.cjs',
        '.ts', '.mts', '.cts',
        '.tsx',
        '.py', '.pyw',
        '.go',
        '.rs',
        '.java',
        '.cs',
        '.c', '.h',
        '.cpp', '.cc', '.cxx', '.hpp', '.hxx',
        '.rb',
        '.php',
      ];
      for (const ext of expectedExtensions) {
        expect(EXTENSION_TO_LANGUAGE.has(ext)).toBe(true);
      }
    });
  });

  describe('LANGUAGE_TO_WASM map', () => {
    it('should have WASM filenames for all 12 supported languages', () => {
      expect(LANGUAGE_TO_WASM.size).toBe(12);
    });

    it('should map to correct WASM filenames', () => {
      expect(LANGUAGE_TO_WASM.get('javascript')).toBe('tree-sitter-javascript.wasm');
      expect(LANGUAGE_TO_WASM.get('typescript')).toBe('tree-sitter-typescript.wasm');
      expect(LANGUAGE_TO_WASM.get('tsx')).toBe('tree-sitter-tsx.wasm');
      expect(LANGUAGE_TO_WASM.get('python')).toBe('tree-sitter-python.wasm');
    });
  });

  describe('DECLARATION_NODE_TYPES map', () => {
    it('should have entries for all 12 supported languages', () => {
      expect(DECLARATION_NODE_TYPES.size).toBe(12);
    });
  });
});
