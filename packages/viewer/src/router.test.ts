import { describe, it, expect, beforeEach } from 'vitest';
import { parseHash, navigate, type ViewName } from './router.js';

describe('parseHash', () => {
  it('should parse dashboard route', () => {
    const route = parseHash('#/dashboard');
    expect(route.view).toBe('dashboard');
    expect(route.params).toEqual({});
  });

  it('should parse chunks route', () => {
    const route = parseHash('#/chunks');
    expect(route.view).toBe('chunks');
    expect(route.params).toEqual({});
  });

  it('should parse graph route', () => {
    const route = parseHash('#/graph');
    expect(route.view).toBe('graph');
    expect(route.params).toEqual({});
  });

  it('should parse embeddings route', () => {
    const route = parseHash('#/embeddings');
    expect(route.view).toBe('embeddings');
    expect(route.params).toEqual({});
  });

  it('should parse search route', () => {
    const route = parseHash('#/search');
    expect(route.view).toBe('search');
    expect(route.params).toEqual({});
  });

  it('should default to dashboard for empty hash', () => {
    const route = parseHash('');
    expect(route.view).toBe('dashboard');
  });

  it('should default to dashboard for bare hash', () => {
    const route = parseHash('#');
    expect(route.view).toBe('dashboard');
  });

  it('should default to dashboard for invalid view', () => {
    const route = parseHash('#/nonexistent');
    expect(route.view).toBe('dashboard');
  });

  it('should parse URL params from hash', () => {
    const route = parseHash('#/chunks?language=typescript&kind=function');
    expect(route.view).toBe('chunks');
    expect(route.params).toEqual({
      language: 'typescript',
      kind: 'function',
    });
  });

  it('should parse single URL param', () => {
    const route = parseHash('#/graph?rootId=abc123');
    expect(route.view).toBe('graph');
    expect(route.params).toEqual({ rootId: 'abc123' });
  });

  it('should handle hash without leading slash', () => {
    const route = parseHash('#dashboard');
    expect(route.view).toBe('dashboard');
  });

  it('should be case-insensitive for view names', () => {
    const route = parseHash('#/Dashboard');
    expect(route.view).toBe('dashboard');
  });
});

describe('navigate', () => {
  beforeEach(() => {
    // Reset location hash
    window.location.hash = '';
  });

  it('should set hash to view path', () => {
    navigate('chunks');
    expect(window.location.hash).toBe('#/chunks');
  });

  it('should set hash with params', () => {
    navigate('graph', { rootId: 'node1', depth: '3' });
    const hash = window.location.hash;
    expect(hash).toContain('#/graph?');
    expect(hash).toContain('rootId=node1');
    expect(hash).toContain('depth=3');
  });

  it('should not append query string for empty params', () => {
    navigate('dashboard', {});
    expect(window.location.hash).toBe('#/dashboard');
  });

  it('should navigate to each valid view', () => {
    const viewNames: ViewName[] = ['dashboard', 'chunks', 'graph', 'embeddings', 'search'];
    for (const view of viewNames) {
      navigate(view);
      expect(window.location.hash).toBe(`#/${view}`);
    }
  });
});
