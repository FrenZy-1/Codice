/**
 * Tests for duplicate filename handling in the project sidebar.
 *
 * Spec §6: duplicated filenames must be distinguishable, unique names stay
 * clean, and selection identity is the unique file id — never the name.
 */

import { describe, expect, it } from 'vitest';
import {
  findDuplicateFileNames,
  duplicateContext,
  fileSelectionKey,
} from '../lib/fileDuplicates';
import type { DiscoveredFile } from '../types';

function makeFile(
  id: string,
  relativePath: string,
  projectId = 'p1',
): DiscoveredFile {
  const parts = relativePath.split('/');
  const name = parts[parts.length - 1];
  const directory = parts.slice(0, -1).join('/');
  return {
    id,
    projectId,
    relativePath,
    name,
    directory,
    size: 100,
    language: null,
    isConfig: false,
    binary: false,
    excluded: false,
  };
}

describe('findDuplicateFileNames', () => {
  it('unique filenames produce an empty duplicate set', () => {
    const files = [
      makeFile('f1', 'Main.java'),
      makeFile('f2', 'Utils.java'),
      makeFile('f3', 'build.gradle.kts'),
    ];
    const dupes = findDuplicateFileNames(files);
    expect(dupes.size).toBe(0);
  });

  it('duplicate filenames in one directory are detected', () => {
    const files = [
      makeFile('f1', 'src/generated/Model.kt'),
      makeFile('f2', 'src/manual/Model.kt'),
    ];
    const dupes = findDuplicateFileNames(files);
    expect(dupes.has('Model.kt')).toBe(true);
    expect(dupes.size).toBe(1);
  });

  it('duplicate filenames in different directories are detected', () => {
    const files = [
      makeFile('f1', 'src/main/java/com/example/Main.java'),
      makeFile('f2', 'src/test/java/com/example/Main.java'),
      makeFile('f3', 'Utils.java'),
    ];
    const dupes = findDuplicateFileNames(files);
    expect(dupes.has('Main.java')).toBe(true);
    expect(dupes.has('Utils.java')).toBe(false);
  });

  it('duplicate filenames across multiple projects are detected', () => {
    const files = [
      makeFile('f1', 'README.md', 'p1'),
      makeFile('f2', 'docs/README.md', 'p2'),
    ];
    const dupes = findDuplicateFileNames(files);
    expect(dupes.has('README.md')).toBe(true);
  });

  it('three or more occurrences are still one duplicate name', () => {
    const files = [
      makeFile('f1', 'a/index.ts'),
      makeFile('f2', 'b/index.ts'),
      makeFile('f3', 'c/index.ts'),
    ];
    const dupes = findDuplicateFileNames(files);
    expect(dupes.size).toBe(1);
  });
});

describe('duplicateContext', () => {
  it('returns the directory portion with a trailing slash', () => {
    const file = makeFile('f1', 'src/main/java/com/example/Main.java');
    expect(duplicateContext(file)).toBe('src/main/java/com/example/');
  });

  it('returns empty context for root-level files', () => {
    const file = makeFile('f1', 'Main.java');
    expect(duplicateContext(file)).toBe('');
  });
});

describe('selection identity', () => {
  it('duplicated filenames keep distinct selection keys (unique ids)', () => {
    const a = makeFile('id-main-src', 'src/main/java/com/example/Main.java');
    const b = makeFile('id-main-test', 'src/test/java/com/example/Main.java');
    expect(a.name).toBe(b.name);
    expect(fileSelectionKey(a)).not.toBe(fileSelectionKey(b));
    expect(fileSelectionKey(a)).toBe('id-main-src');
    expect(fileSelectionKey(b)).toBe('id-main-test');
  });
});
