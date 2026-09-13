/**
 * Tests for document statistics (pure computations).
 *
 * Covers: selection filtering across projects, kind counts, size metrics,
 * per-language breakdown with percentages, duplicate-name counting and
 * empty-input behavior.
 */

import { describe, expect, it } from 'vitest';
import {
  computeDocumentStats,
  dominantLanguage,
  languageHueColor,
} from '../lib/documentStats';
import type { DiscoveredFile, ProjectEntry } from '../types';

function makeFile(overrides: Partial<DiscoveredFile> & { id: string; projectId: string }): DiscoveredFile {
  return {
    relativePath: overrides.id,
    name: overrides.id,
    directory: '',
    size: 100,
    language: null,
    isConfig: false,
    binary: false,
    excluded: false,
    ...overrides,
  } as DiscoveredFile;
}

function makeProject(id: string, files: DiscoveredFile[]): ProjectEntry {
  return {
    id,
    label: id,
    folderName: id,
    files,
    selectedCount: 0,
    selectedSize: 0,
    warnings: [],
    addedAt: Date.now(),
  };
}

describe('computeDocumentStats', () => {
  it('returns an empty snapshot when nothing is selected', () => {
    const stats = computeDocumentStats([], {});
    expect(stats.selectedFiles).toBe(0);
    expect(stats.totalBytes).toBe(0);
    expect(stats.languages).toEqual([]);
    expect(stats.largest).toBeNull();
  });

  it('filters files down to the selection', () => {
    const project = makeProject('p1', [
      makeFile({ id: 'a', projectId: 'p1' }),
      makeFile({ id: 'b', projectId: 'p1' }),
    ]);
    const stats = computeDocumentStats(project ? [project] : [], {
      p1: new Set(['a']),
    });
    expect(stats.selectedFiles).toBe(1);
  });

  it('supports Map-based selections as well as plain objects', () => {
    const project = makeProject('p1', [
      makeFile({ id: 'a', projectId: 'p1' }),
      makeFile({ id: 'b', projectId: 'p1' }),
    ]);
    const map = new Map([['p1', new Set(['a', 'b'])]]);
    const stats = computeDocumentStats([project], map);
    expect(stats.selectedFiles).toBe(2);
  });

  it('counts source / config / binary kinds independently', () => {
    const project = makeProject('p1', [
      makeFile({ id: 'src.java', projectId: 'p1', language: 'java' }),
      makeFile({ id: 'package.json', projectId: 'p1', isConfig: true, language: 'json' }),
      makeFile({ id: 'logo.png', projectId: 'p1', binary: true }),
    ]);
    const stats = computeDocumentStats([project], {
      p1: new Set(['src.java', 'package.json', 'logo.png']),
    });
    expect(stats.sourceFiles).toBe(1);
    expect(stats.configFiles).toBe(1);
    expect(stats.binaryFiles).toBe(1);
  });

  it('computes total, average and largest size', () => {
    const project = makeProject('p1', [
      makeFile({ id: 'small.ts', projectId: 'p1', size: 10, language: 'typescript' }),
      makeFile({ id: 'big.ts', projectId: 'p1', size: 210, language: 'typescript' }),
      makeFile({ id: 'mid.py', projectId: 'p1', size: 80, language: 'python' }),
    ]);
    const stats = computeDocumentStats([project], {
      p1: new Set(['small.ts', 'big.ts', 'mid.py']),
    });
    expect(stats.totalBytes).toBe(300);
    expect(stats.averageBytes).toBe(100);
    expect(stats.largest?.name).toBe('big.ts');
  });

  it('breaks down by language sorted by bytes with pct', () => {
    const project = makeProject('p1', [
      makeFile({ id: 'a.ts', projectId: 'p1', size: 700, language: 'typescript' }),
      makeFile({ id: 'b.ts', projectId: 'p1', size: 100, language: 'typescript' }),
      makeFile({ id: 'c.py', projectId: 'p1', size: 200, language: 'python' }),
    ]);
    const stats = computeDocumentStats([project], {
      p1: new Set(['a.ts', 'b.ts', 'c.py']),
    });
    expect(stats.languageCount).toBe(2);
    expect(stats.languages[0].id).toBe('typescript');
    expect(stats.languages[0].files).toBe(2);
    expect(stats.languages[0].pct).toBeCloseTo(80, 1);
    expect(stats.languages[1].label).toBe('Python');
  });

  it('treats unknown language as plaintext', () => {
    const project = makeProject('p1', [
      makeFile({ id: 'notes.txt', projectId: 'p1', language: null }),
    ]);
    const stats = computeDocumentStats([project], {
      p1: new Set(['notes.txt']),
    });
    expect(stats.languages[0].id).toBe('plaintext');
    expect(stats.languages[0].label).toBe('Plain text');
  });

  it('counts duplicate file names among the selection only', () => {
    const p1 = makeProject('p1', [
      makeFile({ id: 'm1', projectId: 'p1', name: 'Main.java', relativePath: 'src/main/Main.java' }),
      makeFile({ id: 'u1', projectId: 'p1', name: 'Utils.java' }),
    ]);
    const p2 = makeProject('p2', [
      makeFile({ id: 'm2', projectId: 'p2', name: 'Main.java', relativePath: 'src/test/Main.java' }),
      makeFile({ id: 'm3', projectId: 'p2', name: 'Main.java', relativePath: 'src/it/Main.java' }),
    ]);
    // Only 2 of the 3 Main.java selected → 1 duplicate name.
    const stats = computeDocumentStats([p1, p2], {
      p1: new Set(['m1']),
      p2: new Set(['m2']),
    });
    expect(stats.duplicateNames).toBe(1);
    expect(stats.selectedFiles).toBe(2);

    const allThree = computeDocumentStats([p1, p2], {
      p1: new Set(['m1']),
      p2: new Set(['m2', 'm3']),
    });
    expect(allThree.duplicateNames).toBe(1); // still one NAME duplicated
    expect(allThree.selectedFiles).toBe(3);
  });

  it('aggregates across multiple projects', () => {
    const p1 = makeProject('p1', [
      makeFile({ id: 'a', projectId: 'p1', size: 50, language: 'java' }),
    ]);
    const p2 = makeProject('p2', [
      makeFile({ id: 'b', projectId: 'p2', size: 150, language: 'go' }),
    ]);
    const stats = computeDocumentStats([p1, p2], {
      p1: new Set(['a']),
      p2: new Set(['b']),
    });
    expect(stats.selectedFiles).toBe(2);
    expect(stats.totalBytes).toBe(200);
    expect(stats.languageCount).toBe(2);
  });
});

describe('dominantLanguage', () => {
  it('returns the language with the largest selected byte share', () => {
    const p = makeProject('p', [
      makeFile({ id: 'a', projectId: 'p', size: 100, language: 'java' }),
      makeFile({ id: 'b', projectId: 'p', size: 300, language: 'go' }),
      makeFile({ id: 'c', projectId: 'p', size: 50, language: 'java' }),
    ]);
    expect(dominantLanguage(p, new Set(['a', 'b', 'c']))).toBe('go');
  });

  it('ignores unselected and binary files', () => {
    const p = makeProject('p', [
      makeFile({ id: 'a', projectId: 'p', size: 500, language: 'java' }),
      makeFile({ id: 'b', projectId: 'p', size: 900, language: 'go' }), // unselected
      makeFile({ id: 'c', projectId: 'p', size: 800, language: 'rust', binary: true }),
    ]);
    expect(dominantLanguage(p, new Set(['a']))).toBe('java');
  });

  it('returns null when nothing is selected', () => {
    const p = makeProject('p', [
      makeFile({ id: 'a', projectId: 'p', language: 'java' }),
    ]);
    expect(dominantLanguage(p, new Set())).toBeNull();
  });

  it('maps plaintext for unknown languages and produces stable colors', () => {
    const p = makeProject('p', [
      makeFile({ id: 'a', projectId: 'p', language: null }),
    ]);
    expect(dominantLanguage(p, new Set(['a']))).toBe('plaintext');
    expect(languageHueColor('java')).toBe(languageHueColor('java'));
    expect(languageHueColor('java')).toMatch(/^hsl\(\d+ 62% 55%\)$/);
  });
});
