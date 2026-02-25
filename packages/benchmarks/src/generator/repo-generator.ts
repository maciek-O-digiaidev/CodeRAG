/**
 * Synthetic repository generator for reproducible benchmarks.
 *
 * Creates TypeScript and Python files with known functions, classes,
 * interfaces, imports, and tests. Each entity has a predictable name
 * derived from the seed, making ground-truth chunk lookup deterministic.
 *
 * Same seed + same options = identical output. No network access needed.
 */

import { SeededRng } from './seed-rng.js';

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export type SupportedLanguage = 'typescript' | 'python';
export type Complexity = 'simple' | 'medium' | 'complex';

export interface RepoGeneratorOptions {
  /** PRNG seed — same seed produces identical output. */
  readonly seed: number;
  /** Number of source files to generate (10–1000). */
  readonly fileCount: number;
  /** Languages to include. */
  readonly languages: readonly SupportedLanguage[];
  /** Code complexity tier. */
  readonly complexity: Complexity;
}

export interface GeneratedFile {
  /** Relative path inside the synthetic repo, e.g. "src/auth/auth-service.ts". */
  readonly path: string;
  /** Full file content (source code). */
  readonly content: string;
  /** Language of the file. */
  readonly language: SupportedLanguage;
}

/** A single entity tracked in the manifest for ground-truth queries. */
export interface ManifestEntity {
  /** Unique chunk-style ID: "file:path::type::name". */
  readonly id: string;
  /** Relative file path. */
  readonly filePath: string;
  /** Entity type: function, class, interface, method, test. */
  readonly entityType: string;
  /** Symbol name. */
  readonly name: string;
  /** Module / domain the entity belongs to. */
  readonly module: string;
  /** Language of the containing file. */
  readonly language: SupportedLanguage;
  /** Symbols this entity imports / depends on. */
  readonly dependencies: readonly string[];
  /** Brief human description of what the entity does (for query generation). */
  readonly description: string;
}

/** Full manifest of everything that was generated. */
export interface RepoManifest {
  readonly seed: number;
  readonly options: RepoGeneratorOptions;
  readonly entities: readonly ManifestEntity[];
  readonly modules: readonly string[];
}

export interface GeneratedRepo {
  readonly files: readonly GeneratedFile[];
  readonly manifest: RepoManifest;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODULE_NAMES = [
  'auth', 'billing', 'catalog', 'dashboard', 'email',
  'feed', 'gateway', 'handler', 'inventory', 'jobs',
  'kafka', 'logging', 'metrics', 'notification', 'orders',
  'payments', 'queue', 'reporting', 'search', 'tasks',
  'users', 'validation', 'webhook', 'xml', 'yaml', 'zip',
] as const;

const ACTIONS = [
  'create', 'update', 'delete', 'find', 'list',
  'validate', 'transform', 'parse', 'format', 'calculate',
  'filter', 'merge', 'sort', 'process', 'generate',
  'serialize', 'deserialize', 'encode', 'decode', 'compress',
] as const;

const NOUNS = [
  'record', 'entry', 'item', 'document', 'request',
  'response', 'config', 'event', 'message', 'payload',
  'token', 'session', 'cache', 'buffer', 'stream',
  'report', 'summary', 'batch', 'chunk', 'result',
] as const;

const TS_TYPES = [
  'string', 'number', 'boolean', 'string[]', 'number[]',
  'Record<string, unknown>', 'Map<string, string>', 'Set<string>',
  'Promise<void>', 'Readonly<Record<string, number>>',
] as const;

const PY_TYPES = [
  'str', 'int', 'float', 'bool', 'list[str]',
  'dict[str, Any]', 'set[str]', 'tuple[str, int]',
  'Optional[str]', 'list[int]',
] as const;

// ---------------------------------------------------------------------------
// Name Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toPascalCase(parts: string[]): string {
  return parts.map(capitalize).join('');
}

function toCamelCase(parts: string[]): string {
  const [first, ...rest] = parts;
  return (first ?? '') + rest.map(capitalize).join('');
}

function toSnakeCase(parts: string[]): string {
  return parts.join('_');
}

function toKebabCase(parts: string[]): string {
  return parts.join('-');
}

// ---------------------------------------------------------------------------
// Code Generation Helpers — TypeScript
// ---------------------------------------------------------------------------

interface FunctionSpec {
  name: string;
  params: readonly { name: string; type: string }[];
  returnType: string;
  body: string;
  description: string;
}

function generateTsFunction(rng: SeededRng, action: string, noun: string, complexity: Complexity): FunctionSpec {
  const name = toCamelCase([action, noun]);
  const paramCount = complexity === 'simple' ? 1 : complexity === 'medium' ? 2 : 3;
  const params: { name: string; type: string }[] = [];
  for (let i = 0; i < paramCount; i++) {
    params.push({
      name: i === 0 ? 'input' : `param${i}`,
      type: rng.pick(TS_TYPES),
    });
  }
  const returnType = rng.pick(TS_TYPES);

  const bodyLines: string[] = [];
  if (complexity !== 'simple') {
    bodyLines.push(`  // ${capitalize(action)} the ${noun}`);
    bodyLines.push(`  const result = ${JSON.stringify(`${action}-${noun}`)};`);
    if (complexity === 'complex') {
      bodyLines.push(`  const intermediate = [result, ${JSON.stringify(noun)}].join('-');`);
      bodyLines.push('  if (!intermediate) { throw new Error(\'unexpected\'); }');
    }
    bodyLines.push('  return result as unknown as ' + returnType + ';');
  } else {
    bodyLines.push('  return undefined as unknown as ' + returnType + ';');
  }

  return {
    name,
    params,
    returnType,
    body: bodyLines.join('\n'),
    description: `${capitalize(action)}s the ${noun} and returns a ${returnType}`,
  };
}

function renderTsFunction(fn: FunctionSpec): string {
  const paramStr = fn.params.map((p) => `${p.name}: ${p.type}`).join(', ');
  return [
    `/**`,
    ` * ${fn.description}.`,
    ` */`,
    `export function ${fn.name}(${paramStr}): ${fn.returnType} {`,
    fn.body,
    `}`,
  ].join('\n');
}

interface ClassSpec {
  name: string;
  methods: readonly FunctionSpec[];
  description: string;
}

function generateTsClass(rng: SeededRng, module: string, noun: string, complexity: Complexity): ClassSpec {
  const name = toPascalCase([module, noun, 'service']);
  const methodCount = complexity === 'simple' ? 1 : complexity === 'medium' ? 2 : 3;
  const methods: FunctionSpec[] = [];
  for (let i = 0; i < methodCount; i++) {
    const action = rng.pick(ACTIONS);
    methods.push(generateTsFunction(rng, action, noun, complexity));
  }
  return {
    name,
    methods,
    description: `Service for managing ${noun} operations in the ${module} module`,
  };
}

function renderTsClass(cls: ClassSpec): string {
  const lines: string[] = [
    `/**`,
    ` * ${cls.description}.`,
    ` */`,
    `export class ${cls.name} {`,
  ];
  for (const method of cls.methods) {
    const paramStr = method.params.map((p) => `${p.name}: ${p.type}`).join(', ');
    lines.push('');
    lines.push(`  /** ${method.description}. */`);
    lines.push(`  ${method.name}(${paramStr}): ${method.returnType} {`);
    lines.push(`  ${method.body}`);
    lines.push('  }');
  }
  lines.push('}');
  return lines.join('\n');
}

interface InterfaceSpec {
  name: string;
  fields: readonly { name: string; type: string }[];
  description: string;
}

function generateTsInterface(rng: SeededRng, module: string, noun: string): InterfaceSpec {
  const name = toPascalCase([module, noun]);
  const fieldCount = rng.nextInt(2, 5);
  const fields: { name: string; type: string }[] = [];
  for (let i = 0; i < fieldCount; i++) {
    fields.push({
      name: toCamelCase([rng.pick(ACTIONS), rng.pick(NOUNS)]),
      type: rng.pick(TS_TYPES),
    });
  }
  return {
    name,
    fields,
    description: `Data model for ${noun} in the ${module} domain`,
  };
}

function renderTsInterface(iface: InterfaceSpec): string {
  const lines: string[] = [
    `/**`,
    ` * ${iface.description}.`,
    ` */`,
    `export interface ${iface.name} {`,
  ];
  for (const field of iface.fields) {
    lines.push(`  readonly ${field.name}: ${field.type};`);
  }
  lines.push('}');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Code Generation Helpers — Python
// ---------------------------------------------------------------------------

function generatePyFunction(rng: SeededRng, action: string, noun: string, complexity: Complexity): FunctionSpec {
  const name = toSnakeCase([action, noun]);
  const paramCount = complexity === 'simple' ? 1 : complexity === 'medium' ? 2 : 3;
  const params: { name: string; type: string }[] = [];
  for (let i = 0; i < paramCount; i++) {
    params.push({
      name: i === 0 ? 'input_data' : `param_${i}`,
      type: rng.pick(PY_TYPES),
    });
  }
  const returnType = rng.pick(PY_TYPES);

  const bodyLines: string[] = [];
  bodyLines.push(`    """${capitalize(action)} the ${noun} and return a ${returnType}."""`);
  if (complexity !== 'simple') {
    bodyLines.push(`    result = "${action}_${noun}"`);
    if (complexity === 'complex') {
      bodyLines.push(`    intermediate = f"{result}_{${JSON.stringify(noun)}}"`);
      bodyLines.push('    if not intermediate:');
      bodyLines.push('        raise ValueError("unexpected")');
    }
    bodyLines.push('    return result  # type: ignore[return-value]');
  } else {
    bodyLines.push('    return None  # type: ignore[return-value]');
  }

  return {
    name,
    params,
    returnType,
    body: bodyLines.join('\n'),
    description: `${capitalize(action)}s the ${noun} and returns a ${returnType}`,
  };
}

function renderPyFunction(fn: FunctionSpec): string {
  const paramStr = fn.params.map((p) => `${p.name}: ${p.type}`).join(', ');
  return [
    `def ${fn.name}(${paramStr}) -> ${fn.returnType}:`,
    fn.body,
    '',
  ].join('\n');
}

interface PyClassSpec {
  name: string;
  methods: readonly FunctionSpec[];
  description: string;
}

function generatePyClass(rng: SeededRng, module: string, noun: string, complexity: Complexity): PyClassSpec {
  const name = toPascalCase([module, noun, 'service']);
  const methodCount = complexity === 'simple' ? 1 : complexity === 'medium' ? 2 : 3;
  const methods: FunctionSpec[] = [];
  for (let i = 0; i < methodCount; i++) {
    const action = rng.pick(ACTIONS);
    methods.push(generatePyFunction(rng, action, noun, complexity));
  }
  return {
    name,
    methods,
    description: `Service for managing ${noun} operations in the ${module} module`,
  };
}

function renderPyClass(cls: PyClassSpec): string {
  const lines: string[] = [
    `class ${cls.name}:`,
    `    """${cls.description}."""`,
    '',
  ];
  for (const method of cls.methods) {
    const paramStr = ['self', ...method.params.map((p) => `${p.name}: ${p.type}`)].join(', ');
    lines.push(`    def ${method.name}(${paramStr}) -> ${method.returnType}:`);
    lines.push(`    ${method.body}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// File-Level Generators
// ---------------------------------------------------------------------------

interface FileBlueprint {
  path: string;
  language: SupportedLanguage;
  module: string;
  entities: ManifestEntity[];
  content: string;
}

function generateTsSourceFile(
  rng: SeededRng,
  module: string,
  fileIndex: number,
  complexity: Complexity,
  existingFiles: readonly FileBlueprint[],
): FileBlueprint {
  const noun = rng.pick(NOUNS);
  const fileName = toKebabCase([module, noun, String(fileIndex)]) + '.ts';
  const filePath = `src/${module}/${fileName}`;
  const entities: ManifestEntity[] = [];
  const contentParts: string[] = [];

  // Imports from other files in the same module (cross-file deps)
  const sameModuleFiles = existingFiles.filter(
    (f) => f.module === module && f.language === 'typescript',
  );
  const importedNames: string[] = [];
  if (sameModuleFiles.length > 0 && rng.nextBool(0.6)) {
    const importSource = rng.pick(sameModuleFiles);
    const importableEntities = importSource.entities.filter(
      (e) => e.entityType === 'function' || e.entityType === 'class' || e.entityType === 'interface',
    );
    if (importableEntities.length > 0) {
      const imported = rng.pick(importableEntities);
      // Compute relative import from current file's directory
      const relImport = `../${importSource.module}/${importSource.path.split('/').pop()?.replace(/\.ts$/, '.js') ?? ''}`;
      const importPath = importSource.module === module ? `./${importSource.path.split('/').pop()?.replace(/\.ts$/, '.js') ?? ''}` : relImport;
      contentParts.push(`import { ${imported.name} } from '${importPath}';`);
      importedNames.push(imported.name);
    }
  }

  contentParts.push('');

  // Generate an interface
  const iface = generateTsInterface(rng, module, noun);
  contentParts.push(renderTsInterface(iface));
  contentParts.push('');
  entities.push({
    id: `file:${filePath}::interface::${iface.name}`,
    filePath,
    entityType: 'interface',
    name: iface.name,
    module,
    language: 'typescript',
    dependencies: [],
    description: iface.description,
  });

  // Generate standalone functions — use fileIndex suffix for uniqueness
  const fnCount = complexity === 'simple' ? 1 : complexity === 'medium' ? 2 : 3;
  const usedFnNames = new Set<string>();
  for (let i = 0; i < fnCount; i++) {
    const action = rng.pick(ACTIONS);
    const fn = generateTsFunction(rng, action, noun, complexity);
    // Ensure unique name within file by appending index if needed
    let uniqueName = fn.name;
    if (usedFnNames.has(uniqueName)) {
      uniqueName = `${fn.name}${fileIndex}x${i}`;
    }
    usedFnNames.add(uniqueName);
    const finalFn = { ...fn, name: uniqueName };
    contentParts.push(renderTsFunction(finalFn));
    contentParts.push('');
    entities.push({
      id: `file:${filePath}::function::${finalFn.name}`,
      filePath,
      entityType: 'function',
      name: finalFn.name,
      module,
      language: 'typescript',
      dependencies: importedNames,
      description: finalFn.description,
    });
  }

  // Generate a class
  const cls = generateTsClass(rng, module, noun, complexity);
  contentParts.push(renderTsClass(cls));
  contentParts.push('');
  entities.push({
    id: `file:${filePath}::class::${cls.name}`,
    filePath,
    entityType: 'class',
    name: cls.name,
    module,
    language: 'typescript',
    dependencies: importedNames,
    description: cls.description,
  });
  const usedMethodNames = new Set<string>();
  for (const method of cls.methods) {
    let methodFullName = `${cls.name}.${method.name}`;
    if (usedMethodNames.has(methodFullName)) {
      methodFullName = `${cls.name}.${method.name}${fileIndex}`;
    }
    usedMethodNames.add(methodFullName);
    entities.push({
      id: `file:${filePath}::method::${methodFullName}`,
      filePath,
      entityType: 'method',
      name: methodFullName,
      module,
      language: 'typescript',
      dependencies: [],
      description: method.description,
    });
  }

  return {
    path: filePath,
    language: 'typescript',
    module,
    entities,
    content: contentParts.join('\n'),
  };
}

function generateTsTestFile(
  _rng: SeededRng,
  sourceFile: FileBlueprint,
): FileBlueprint {
  const testPath = sourceFile.path.replace(/\.ts$/, '.test.ts');
  const sourceBaseName = sourceFile.path.split('/').pop()?.replace(/\.ts$/, '') ?? '';
  const entities: ManifestEntity[] = [];
  const lines: string[] = [];

  // Gather importable symbols
  const importableEntities = sourceFile.entities.filter(
    (e) => e.entityType === 'function' || e.entityType === 'class',
  );
  const importNames = importableEntities.map((e) => {
    // For class entities, the name is the class name itself
    return e.entityType === 'class' ? e.name : e.name;
  });

  lines.push(`import { describe, it, expect } from 'vitest';`);
  if (importNames.length > 0) {
    lines.push(`import { ${importNames.join(', ')} } from './${sourceBaseName}.js';`);
  }
  lines.push('');

  for (const entity of importableEntities) {
    const testName = `${entity.name} test`;
    lines.push(`describe('${entity.name}', () => {`);
    lines.push(`  it('should exist and be callable', () => {`);
    if (entity.entityType === 'function') {
      lines.push(`    expect(typeof ${entity.name}).toBe('function');`);
    } else {
      lines.push(`    const instance = new ${entity.name}();`);
      lines.push(`    expect(instance).toBeDefined();`);
    }
    lines.push(`  });`);
    lines.push(`});`);
    lines.push('');

    entities.push({
      id: `file:${testPath}::test::${entity.name}`,
      filePath: testPath,
      entityType: 'test',
      name: testName,
      module: sourceFile.module,
      language: 'typescript',
      dependencies: [entity.name],
      description: `Test suite for ${entity.name}`,
    });
  }

  return {
    path: testPath,
    language: 'typescript',
    module: sourceFile.module,
    entities,
    content: lines.join('\n'),
  };
}

function generatePySourceFile(
  rng: SeededRng,
  module: string,
  fileIndex: number,
  complexity: Complexity,
  existingFiles: readonly FileBlueprint[],
): FileBlueprint {
  const noun = rng.pick(NOUNS);
  const fileName = toSnakeCase([module, noun, String(fileIndex)]) + '.py';
  const filePath = `src/${module}/${fileName}`;
  const entities: ManifestEntity[] = [];
  const contentParts: string[] = [];

  contentParts.push(`"""${capitalize(module)} ${noun} module."""`);
  contentParts.push('from __future__ import annotations');
  contentParts.push('from typing import Any, Optional');
  contentParts.push('');

  // Imports from other files
  const sameModuleFiles = existingFiles.filter(
    (f) => f.module === module && f.language === 'python',
  );
  const importedNames: string[] = [];
  if (sameModuleFiles.length > 0 && rng.nextBool(0.6)) {
    const importSource = rng.pick(sameModuleFiles);
    const importable = importSource.entities.filter(
      (e) => e.entityType === 'function' || e.entityType === 'class',
    );
    if (importable.length > 0) {
      const imported = rng.pick(importable);
      const pyModule = importSource.path.replace(/^src\//, '').replace(/\.py$/, '').replace(/\//g, '.');
      contentParts.push(`from ${pyModule} import ${imported.name}`);
      importedNames.push(imported.name);
    }
  }
  contentParts.push('');

  // Generate standalone functions — use fileIndex suffix for uniqueness
  const fnCount = complexity === 'simple' ? 1 : complexity === 'medium' ? 2 : 3;
  const usedPyFnNames = new Set<string>();
  for (let i = 0; i < fnCount; i++) {
    const action = rng.pick(ACTIONS);
    const fn = generatePyFunction(rng, action, noun, complexity);
    let uniqueName = fn.name;
    if (usedPyFnNames.has(uniqueName)) {
      uniqueName = `${fn.name}_${fileIndex}_${i}`;
    }
    usedPyFnNames.add(uniqueName);
    const finalFn = { ...fn, name: uniqueName };
    contentParts.push(renderPyFunction(finalFn));
    entities.push({
      id: `file:${filePath}::function::${finalFn.name}`,
      filePath,
      entityType: 'function',
      name: finalFn.name,
      module,
      language: 'python',
      dependencies: importedNames,
      description: finalFn.description,
    });
  }

  // Generate a class
  const cls = generatePyClass(rng, module, noun, complexity);
  contentParts.push(renderPyClass(cls));
  entities.push({
    id: `file:${filePath}::class::${cls.name}`,
    filePath,
    entityType: 'class',
    name: cls.name,
    module,
    language: 'python',
    dependencies: importedNames,
    description: cls.description,
  });
  const usedPyMethodNames = new Set<string>();
  for (const method of cls.methods) {
    let methodFullName = `${cls.name}.${method.name}`;
    if (usedPyMethodNames.has(methodFullName)) {
      methodFullName = `${cls.name}.${method.name}_${fileIndex}`;
    }
    usedPyMethodNames.add(methodFullName);
    entities.push({
      id: `file:${filePath}::method::${methodFullName}`,
      filePath,
      entityType: 'method',
      name: methodFullName,
      module,
      language: 'python',
      dependencies: [],
      description: method.description,
    });
  }

  return {
    path: filePath,
    language: 'python',
    module,
    entities,
    content: contentParts.join('\n'),
  };
}

function generatePyTestFile(
  _rng: SeededRng,
  sourceFile: FileBlueprint,
): FileBlueprint {
  const baseName = sourceFile.path.split('/').pop()?.replace(/\.py$/, '') ?? '';
  const testPath = `src/${sourceFile.module}/test_${baseName}.py`;
  const entities: ManifestEntity[] = [];
  const lines: string[] = [];

  const importableEntities = sourceFile.entities.filter(
    (e) => e.entityType === 'function' || e.entityType === 'class',
  );
  const pyModule = sourceFile.path.replace(/^src\//, '').replace(/\.py$/, '').replace(/\//g, '.');

  lines.push(`"""Tests for ${baseName} module."""`);
  lines.push('import pytest');
  if (importableEntities.length > 0) {
    const names = importableEntities.map((e) => e.name);
    lines.push(`from ${pyModule} import ${names.join(', ')}`);
  }
  lines.push('');

  for (const entity of importableEntities) {
    const testFnName = `test_${entity.entityType === 'class' ? toSnakeCase(entity.name.split(/(?=[A-Z])/).map((s) => s.toLowerCase())) : entity.name}`;
    if (entity.entityType === 'function') {
      lines.push(`def ${testFnName}():`);
      lines.push(`    """Test that ${entity.name} is callable."""`);
      lines.push(`    assert callable(${entity.name})`);
    } else {
      lines.push(`def ${testFnName}():`);
      lines.push(`    """Test that ${entity.name} can be instantiated."""`);
      lines.push(`    instance = ${entity.name}()`);
      lines.push(`    assert instance is not None`);
    }
    lines.push('');

    entities.push({
      id: `file:${testPath}::test::${entity.name}`,
      filePath: testPath,
      entityType: 'test',
      name: `${testFnName} test`,
      module: sourceFile.module,
      language: 'python',
      dependencies: [entity.name],
      description: `Test for ${entity.name}`,
    });
  }

  return {
    path: testPath,
    language: 'python',
    module: sourceFile.module,
    entities,
    content: lines.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Main Generator
// ---------------------------------------------------------------------------

/**
 * Generate a synthetic repository with deterministic, reproducible output.
 *
 * The generator distributes files evenly across selected modules,
 * alternating languages if multiple are specified.
 *
 * @param options - Generation parameters (seed, fileCount, languages, complexity)
 * @returns A GeneratedRepo with files and a manifest of all known entities
 */
export function generateRepo(options: RepoGeneratorOptions): GeneratedRepo {
  const { seed, fileCount, languages, complexity } = options;
  const clampedFileCount = Math.max(10, Math.min(1000, fileCount));
  const rng = new SeededRng(seed);

  // Select modules based on file count
  const moduleCount = Math.min(Math.max(2, Math.ceil(clampedFileCount / 5)), MODULE_NAMES.length);
  const selectedModules = rng.sample([...MODULE_NAMES], moduleCount);

  const blueprints: FileBlueprint[] = [];

  // Generate source files
  for (let i = 0; i < clampedFileCount; i++) {
    const module = selectedModules[i % selectedModules.length]!;
    const language = languages[i % languages.length]!;

    const blueprint =
      language === 'typescript'
        ? generateTsSourceFile(rng, module, i, complexity, blueprints)
        : generatePySourceFile(rng, module, i, complexity, blueprints);

    blueprints.push(blueprint);
  }

  // Generate test files for ~60% of source files
  const testBlueprints: FileBlueprint[] = [];
  for (const source of blueprints) {
    if (rng.nextBool(0.6)) {
      const testBp =
        source.language === 'typescript'
          ? generateTsTestFile(rng, source)
          : generatePyTestFile(rng, source);
      testBlueprints.push(testBp);
    }
  }

  const allBlueprints = [...blueprints, ...testBlueprints];

  const files: GeneratedFile[] = allBlueprints.map((bp) => ({
    path: bp.path,
    content: bp.content,
    language: bp.language,
  }));

  const allEntities: ManifestEntity[] = allBlueprints.flatMap((bp) => bp.entities);

  return {
    files,
    manifest: {
      seed,
      options,
      entities: allEntities,
      modules: selectedModules,
    },
  };
}
