import { describe, it, expect } from 'vitest';
import { safeString, safeNumber, safeRecord, safeArray, safeStringUnion } from './safe-cast.js';

describe('safeString', () => {
  it('should return the value when it is a string', () => {
    expect(safeString('hello')).toBe('hello');
  });

  it('should return empty string when value is empty string', () => {
    expect(safeString('')).toBe('');
  });

  it('should return fallback when value is not a string', () => {
    expect(safeString(42, 'fallback')).toBe('fallback');
    expect(safeString(null, 'default')).toBe('default');
    expect(safeString(undefined, 'default')).toBe('default');
    expect(safeString(true, 'default')).toBe('default');
    expect(safeString({}, 'default')).toBe('default');
    expect(safeString([], 'default')).toBe('default');
  });

  it('should throw TypeError when value is not a string and no fallback', () => {
    expect(() => safeString(42)).toThrow(TypeError);
    expect(() => safeString(42)).toThrow('Expected string, got number');
    expect(() => safeString(null)).toThrow(TypeError);
    expect(() => safeString(undefined)).toThrow('Expected string, got undefined');
    expect(() => safeString(true)).toThrow('Expected string, got boolean');
  });

  it('should return the string value even when a fallback is provided', () => {
    expect(safeString('actual', 'fallback')).toBe('actual');
  });
});

describe('safeNumber', () => {
  it('should return the value when it is a number', () => {
    expect(safeNumber(42)).toBe(42);
    expect(safeNumber(0)).toBe(0);
    expect(safeNumber(-1.5)).toBe(-1.5);
  });

  it('should return fallback when value is not a number', () => {
    expect(safeNumber('hello', 0)).toBe(0);
    expect(safeNumber(null, 99)).toBe(99);
    expect(safeNumber(undefined, -1)).toBe(-1);
    expect(safeNumber(true, 0)).toBe(0);
  });

  it('should return fallback for NaN', () => {
    expect(safeNumber(NaN, 0)).toBe(0);
  });

  it('should return fallback for Infinity', () => {
    expect(safeNumber(Infinity, 0)).toBe(0);
    expect(safeNumber(-Infinity, 0)).toBe(0);
  });

  it('should throw TypeError when value is not a number and no fallback', () => {
    expect(() => safeNumber('hello')).toThrow(TypeError);
    expect(() => safeNumber('hello')).toThrow('Expected number, got string');
    expect(() => safeNumber(null)).toThrow(TypeError);
  });

  it('should throw for NaN without fallback', () => {
    expect(() => safeNumber(NaN)).toThrow(TypeError);
  });

  it('should return the number value even when a fallback is provided', () => {
    expect(safeNumber(42, 0)).toBe(42);
  });
});

describe('safeRecord', () => {
  it('should return the value when it is a plain object', () => {
    const obj = { a: 1, b: 'two' };
    expect(safeRecord(obj)).toEqual({ a: 1, b: 'two' });
  });

  it('should return empty object when value is empty object', () => {
    expect(safeRecord({})).toEqual({});
  });

  it('should return fallback when value is null', () => {
    expect(safeRecord(null, {})).toEqual({});
  });

  it('should return fallback when value is an array', () => {
    expect(safeRecord([1, 2], { default: true })).toEqual({ default: true });
  });

  it('should return fallback when value is a string', () => {
    expect(safeRecord('not-object', {})).toEqual({});
  });

  it('should return fallback when value is undefined', () => {
    expect(safeRecord(undefined, { key: 'val' })).toEqual({ key: 'val' });
  });

  it('should throw TypeError when value is not a record and no fallback', () => {
    expect(() => safeRecord(null)).toThrow(TypeError);
    expect(() => safeRecord(null)).toThrow('Expected record (object), got null');
    expect(() => safeRecord('hello')).toThrow('Expected record (object), got string');
    expect(() => safeRecord(42)).toThrow('Expected record (object), got number');
  });

  it('should throw for array without fallback', () => {
    expect(() => safeRecord([1, 2])).toThrow('Expected record (object), got array');
  });

  it('should return the record value even when a fallback is provided', () => {
    const obj = { real: true };
    expect(safeRecord(obj, { fallback: true })).toEqual({ real: true });
  });
});

describe('safeArray', () => {
  it('should return the value when it is an array', () => {
    expect(safeArray([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('should return empty array when value is empty array', () => {
    expect(safeArray([])).toEqual([]);
  });

  it('should return fallback when value is not an array', () => {
    expect(safeArray('hello', [])).toEqual([]);
    expect(safeArray(null, [1])).toEqual([1]);
    expect(safeArray({}, [2])).toEqual([2]);
    expect(safeArray(42, [])).toEqual([]);
  });

  it('should throw TypeError when value is not an array and no fallback', () => {
    expect(() => safeArray('hello')).toThrow(TypeError);
    expect(() => safeArray('hello')).toThrow('Expected array, got string');
    expect(() => safeArray(null)).toThrow(TypeError);
    expect(() => safeArray({})).toThrow('Expected array, got object');
  });

  it('should return the array value even when a fallback is provided', () => {
    expect(safeArray([1, 2], [3, 4])).toEqual([1, 2]);
  });
});

describe('safeStringUnion', () => {
  const CHUNK_TYPES = ['function', 'method', 'class', 'module', 'interface', 'type_alias', 'config_block', 'import_block', 'doc'] as const;

  it('should return the value when it matches an allowed value', () => {
    expect(safeStringUnion('function', CHUNK_TYPES)).toBe('function');
    expect(safeStringUnion('class', CHUNK_TYPES)).toBe('class');
    expect(safeStringUnion('doc', CHUNK_TYPES)).toBe('doc');
  });

  it('should return fallback when value does not match', () => {
    expect(safeStringUnion('unknown', CHUNK_TYPES, 'function')).toBe('function');
    expect(safeStringUnion('', CHUNK_TYPES, 'module')).toBe('module');
  });

  it('should return fallback when value is not a string', () => {
    expect(safeStringUnion(42, CHUNK_TYPES, 'function')).toBe('function');
    expect(safeStringUnion(null, CHUNK_TYPES, 'class')).toBe('class');
    expect(safeStringUnion(undefined, CHUNK_TYPES, 'method')).toBe('method');
  });

  it('should throw TypeError when value does not match and no fallback', () => {
    expect(() => safeStringUnion('unknown', CHUNK_TYPES)).toThrow(TypeError);
    expect(() => safeStringUnion('unknown', CHUNK_TYPES)).toThrow('Expected one of');
    expect(() => safeStringUnion('unknown', CHUNK_TYPES)).toThrow('"unknown"');
  });

  it('should throw TypeError when value is not a string and no fallback', () => {
    expect(() => safeStringUnion(42, CHUNK_TYPES)).toThrow(TypeError);
    expect(() => safeStringUnion(42, CHUNK_TYPES)).toThrow('Expected one of');
  });

  it('should return the matched value even when a fallback is provided', () => {
    expect(safeStringUnion('class', CHUNK_TYPES, 'function')).toBe('class');
  });

  it('should work with small union types', () => {
    const modes = ['read', 'write'] as const;
    expect(safeStringUnion('read', modes)).toBe('read');
    expect(safeStringUnion('other', modes, 'read')).toBe('read');
  });
});
