import { describe, expect, it } from 'vitest';
import { matchGlob, globToRegex } from '../lib/glob';

describe('globToRegex', () => {
  it('matches literal patterns', () => {
    const re = globToRegex('foo.txt');
    expect(re.test('foo.txt')).toBe(true);
    expect(re.test('bar.txt')).toBe(false);
  });

  it('escapes regex special characters', () => {
    const re = globToRegex('a+b.c');
    expect(re.test('a+b.c')).toBe(true);
    expect(re.test('axbxc')).toBe(false);
  });
});

describe('matchGlob', () => {
  it('matches a single * within a segment', () => {
    expect(matchGlob('foo.txt', '*.txt')).toBe(true);
    expect(matchGlob('foo.json', '*.txt')).toBe(false);
    expect(matchGlob('path/to/foo.txt', '*.txt')).toBe(true); // basename match
  });

  it('matches ** across path segments', () => {
    expect(matchGlob('src/main/java/Main.java', '**/*.java')).toBe(true);
    expect(matchGlob('src/Main.java', '**/*.java')).toBe(true);
    expect(matchGlob('Main.java', '**/*.java')).toBe(true);
  });

  it('matches brace expansion', () => {
    expect(matchGlob('app.ts', '*.{ts,tsx}')).toBe(true);
    expect(matchGlob('app.tsx', '*.{ts,tsx}')).toBe(true);
    expect(matchGlob('app.js', '*.{ts,tsx}')).toBe(false);
  });

  it('matches ? as a single char', () => {
    expect(matchGlob('app.ts', 'app.?s')).toBe(true);
    expect(matchGlob('app.tss', 'app.?s')).toBe(false);
  });

  it('handles patterns with no slash as basename match', () => {
    expect(matchGlob('a/b/c.txt', '*.txt')).toBe(true);
    expect(matchGlob('a/b/c.json', '*.txt')).toBe(false);
  });

  it('handles patterns with slash as full path match', () => {
    expect(matchGlob('src/main.ts', 'src/*.ts')).toBe(true);
    expect(matchGlob('lib/main.ts', 'src/*.ts')).toBe(false);
  });

  it('returns false for empty patterns', () => {
    expect(matchGlob('foo', '')).toBe(false);
  });
});
