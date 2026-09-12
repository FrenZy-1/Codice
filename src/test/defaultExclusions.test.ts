import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXCLUDED_DIRS,
  DEFAULT_EXCLUDED_EXTENSIONS,
  DEFAULT_EXCLUDED_FILENAMES,
  defaultFilterConfig,
  LARGE_FILE_THRESHOLD,
} from '../lib/defaultExclusions';

describe('defaultExclusions', () => {
  it('includes common build/output dirs', () => {
    expect(DEFAULT_EXCLUDED_DIRS).toContain('node_modules');
    expect(DEFAULT_EXCLUDED_DIRS).toContain('.git');
    expect(DEFAULT_EXCLUDED_DIRS).toContain('build');
    expect(DEFAULT_EXCLUDED_DIRS).toContain('dist');
    expect(DEFAULT_EXCLUDED_DIRS).toContain('target');
    expect(DEFAULT_EXCLUDED_DIRS).toContain('.gradle');
    expect(DEFAULT_EXCLUDED_DIRS).toContain('__pycache__');
    expect(DEFAULT_EXCLUDED_DIRS).toContain('coverage');
    expect(DEFAULT_EXCLUDED_DIRS).toContain('.idea');
    expect(DEFAULT_EXCLUDED_DIRS).toContain('.vscode');
  });

  it('includes common binary extensions', () => {
    expect(DEFAULT_EXCLUDED_EXTENSIONS).toContain('exe');
    expect(DEFAULT_EXCLUDED_EXTENSIONS).toContain('class');
    expect(DEFAULT_EXCLUDED_EXTENSIONS).toContain('jar');
    expect(DEFAULT_EXCLUDED_EXTENSIONS).toContain('png');
    expect(DEFAULT_EXCLUDED_EXTENSIONS).toContain('jpg');
    expect(DEFAULT_EXCLUDED_EXTENSIONS).toContain('zip');
    expect(DEFAULT_EXCLUDED_EXTENSIONS).toContain('pdf');
  });

  it('includes lockfile / OS metadata filenames', () => {
    expect(DEFAULT_EXCLUDED_FILENAMES).toContain('package-lock.json');
    expect(DEFAULT_EXCLUDED_FILENAMES).toContain('yarn.lock');
    expect(DEFAULT_EXCLUDED_FILENAMES).toContain('.DS_Store');
    expect(DEFAULT_EXCLUDED_FILENAMES).toContain('Thumbs.db');
  });

  it('defaultFilterConfig returns a fresh copy', () => {
    const a = defaultFilterConfig();
    const b = defaultFilterConfig();
    expect(a).not.toBe(b);
    expect(a.excludedDirs).not.toBe(b.excludedDirs);
    a.excludedDirs.push('foo');
    expect(b.excludedDirs).not.toContain('foo');
  });

  it('LARGE_FILE_THRESHOLD is reasonable', () => {
    expect(LARGE_FILE_THRESHOLD).toBeGreaterThan(100 * 1024);
    expect(LARGE_FILE_THRESHOLD).toBeLessThan(5 * 1024 * 1024);
  });
});
