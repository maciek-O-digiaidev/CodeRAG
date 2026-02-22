import { describe, it, expect } from 'vitest';
import { scanForClickUpReferences } from './clickup-reference-scanner.js';

describe('scanForClickUpReferences', () => {
  it('should extract a single CU- reference', () => {
    const result = scanForClickUpReferences('Fixes CU-abc123');
    expect(result).toEqual(['CU-abc123']);
  });

  it('should extract a single # reference', () => {
    const result = scanForClickUpReferences('Fixes #12345');
    expect(result).toEqual(['#12345']);
  });

  it('should extract multiple CU- references', () => {
    const result = scanForClickUpReferences('Related to CU-abc and CU-def');
    expect(result).toEqual(['CU-abc', 'CU-def']);
  });

  it('should extract mixed CU- and # references', () => {
    const result = scanForClickUpReferences('CU-task1 and #98765');
    expect(result).toEqual(['CU-task1', '#98765']);
  });

  it('should return empty array when no references found', () => {
    const result = scanForClickUpReferences('No task references here');
    expect(result).toEqual([]);
  });

  it('should handle empty string', () => {
    const result = scanForClickUpReferences('');
    expect(result).toEqual([]);
  });

  it('should deduplicate repeated CU- references', () => {
    const content = 'CU-abc mentioned first, then CU-abc again';
    const result = scanForClickUpReferences(content);
    expect(result).toEqual(['CU-abc']);
  });

  it('should deduplicate repeated # references', () => {
    const content = '#123 first, then #123 again';
    const result = scanForClickUpReferences(content);
    expect(result).toEqual(['#123']);
  });

  it('should handle references in code comments', () => {
    const code = `
      // CU-task42: Fix authentication bug
      function login() { return true; }
    `;
    const result = scanForClickUpReferences(code);
    expect(result).toEqual(['CU-task42']);
  });

  it('should handle references in block comments', () => {
    const code = `
      /*
       * Implements CU-epic1 and CU-story2
       */
      export class AuthService {}
    `;
    const result = scanForClickUpReferences(code);
    expect(result).toEqual(['CU-epic1', 'CU-story2']);
  });

  it('should handle references in string literals', () => {
    const code = `const ref = "CU-xyz789";`;
    const result = scanForClickUpReferences(code);
    expect(result).toEqual(['CU-xyz789']);
  });

  it('should extract references across multiple lines', () => {
    const content = `
Line 1: CU-a1
Line 2: nothing here
Line 3: #200 and CU-b2
Line 4: also CU-a1 (duplicate)
    `;
    const result = scanForClickUpReferences(content);
    expect(result).toEqual(['CU-a1', '#200', 'CU-b2']);
  });

  it('should handle CU- with only digits', () => {
    const result = scanForClickUpReferences('CU-12345');
    expect(result).toEqual(['CU-12345']);
  });

  it('should handle CU- with mixed case alphanumeric', () => {
    const result = scanForClickUpReferences('CU-AbCd123');
    expect(result).toEqual(['CU-AbCd123']);
  });

  it('should not match CU- without an ID', () => {
    const result = scanForClickUpReferences('CU- is not valid');
    expect(result).toEqual([]);
  });

  it('should not match # without an ID', () => {
    const result = scanForClickUpReferences('# is not valid');
    expect(result).toEqual([]);
  });

  it('should handle adjacent text around references', () => {
    const result = scanForClickUpReferences('seeCU-55end');
    expect(result).toEqual(['CU-55end']);
  });
});
