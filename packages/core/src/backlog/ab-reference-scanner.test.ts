import { describe, it, expect } from 'vitest';
import { scanForABReferences } from './ab-reference-scanner.js';

describe('scanForABReferences', () => {
  it('should extract a single AB# reference', () => {
    const result = scanForABReferences('Fixes AB#123');
    expect(result).toEqual(['123']);
  });

  it('should extract multiple AB# references', () => {
    const result = scanForABReferences('Related to AB#123 and AB#456');
    expect(result).toEqual(['123', '456']);
  });

  it('should extract multiple references on the same line', () => {
    const result = scanForABReferences('AB#10 AB#20 AB#30');
    expect(result).toEqual(['10', '20', '30']);
  });

  it('should return empty array when no references found', () => {
    const result = scanForABReferences('No work item references here');
    expect(result).toEqual([]);
  });

  it('should handle references in code comments (single-line)', () => {
    const code = `
      // AB#100: Fix authentication bug
      function login() { return true; }
    `;
    const result = scanForABReferences(code);
    expect(result).toEqual(['100']);
  });

  it('should handle references in block comments', () => {
    const code = `
      /*
       * Implements AB#200 and AB#201
       */
      export class AuthService {}
    `;
    const result = scanForABReferences(code);
    expect(result).toEqual(['200', '201']);
  });

  it('should handle references in string literals', () => {
    const code = `const ref = "AB#999";`;
    const result = scanForABReferences(code);
    expect(result).toEqual(['999']);
  });

  it('should deduplicate repeated references', () => {
    const content = 'AB#42 mentioned first, then AB#42 again';
    const result = scanForABReferences(content);
    expect(result).toEqual(['42']);
  });

  it('should not match AB# without a number', () => {
    const result = scanForABReferences('AB# is not valid');
    expect(result).toEqual([]);
  });

  it('should match AB#0 as a valid reference', () => {
    const result = scanForABReferences('AB#0 is technically valid');
    expect(result).toEqual(['0']);
  });

  it('should handle large IDs', () => {
    const result = scanForABReferences('AB#1234567890');
    expect(result).toEqual(['1234567890']);
  });

  it('should extract references across multiple lines', () => {
    const content = `
Line 1: AB#1
Line 2: nothing here
Line 3: AB#2 and AB#3
Line 4: also AB#1 (duplicate)
    `;
    const result = scanForABReferences(content);
    expect(result).toEqual(['1', '2', '3']);
  });

  it('should handle empty string', () => {
    const result = scanForABReferences('');
    expect(result).toEqual([]);
  });

  it('should not match lowercase ab#123', () => {
    const result = scanForABReferences('ab#123 is not valid');
    expect(result).toEqual([]);
  });

  it('should handle AB# adjacent to other text', () => {
    const result = scanForABReferences('seeAB#55end');
    expect(result).toEqual(['55']);
  });
});
