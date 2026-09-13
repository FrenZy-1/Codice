import { describe, expect, it } from 'vitest';
import { discoverFromFiles, formatBytes } from '../lib/fileDiscovery';

describe('discoverFromFiles', () => {
  /** Helper: build a File with a synthetic webkitRelativePath. */
  function makeFile(name: string, content: string, relPath: string): File {
    const f = new File([content], name, { type: 'text/plain' });
    Object.defineProperty(f, 'webkitRelativePath', {
      value: relPath,
      configurable: true,
    });
    return f;
  }

  it('derives project folder name from webkitRelativePath', async () => {
    const files = [
      makeFile('Main.java', 'class Main {}', 'MyProject/src/Main.java'),
    ];
    const project = await discoverFromFiles(files, {
      excludedDirs: [],
      excludedExtensions: [],
      excludedFilenames: [],
      includeGlobs: [],
      excludeGlobs: [],
      includeSource: true,
      includeConfig: true,
      includeMarkdown: true,
      customExtensions: [],
    });
    expect(project.folderName).toBe('MyProject');
    expect(project.label).toBe('MyProject');
    expect(project.files).toHaveLength(1);
    expect(project.files[0].relativePath).toBe('src/Main.java');
  });

  it('excludes files in excluded directories', async () => {
    const files = [
      makeFile('Main.java', 'class Main {}', 'P/src/Main.java'),
      makeFile('cache.txt', 'x', 'P/node_modules/cache.txt'),
    ];
    const project = await discoverFromFiles(files, {
      excludedDirs: ['node_modules'],
      excludedExtensions: [],
      excludedFilenames: [],
      includeGlobs: [],
      excludeGlobs: [],
      includeSource: true,
      includeConfig: true,
      includeMarkdown: true,
      customExtensions: [],
    });
    expect(project.files).toHaveLength(1);
    expect(project.files[0].relativePath).toBe('src/Main.java');
  });

  it('excludes files by extension', async () => {
    const files = [
      makeFile('Main.java', 'class Main {}', 'P/src/Main.java'),
      makeFile('image.png', 'x', 'P/assets/image.png'),
    ];
    const project = await discoverFromFiles(files, {
      excludedDirs: [],
      excludedExtensions: ['png'],
      excludedFilenames: [],
      includeGlobs: [],
      excludeGlobs: [],
      includeSource: true,
      includeConfig: true,
      includeMarkdown: true,
      customExtensions: [],
    });
    expect(project.files).toHaveLength(1);
    expect(project.files[0].name).toBe('Main.java');
  });

  it('respects includeGlobs to override exclusions', async () => {
    const files = [
      makeFile('Main.java', 'class Main {}', 'P/src/Main.java'),
      makeFile('config.bin', 'x', 'P/config.bin'),
    ];
    const project = await discoverFromFiles(files, {
      excludedDirs: [],
      excludedExtensions: ['bin'],
      excludedFilenames: [],
      includeGlobs: ['config.bin'],
      excludeGlobs: [],
      includeSource: true,
      includeConfig: true,
      includeMarkdown: true,
      customExtensions: [],
    });
    const paths = project.files.map((f) => f.relativePath).sort();
    expect(paths).toEqual(['config.bin', 'src/Main.java']);
  });

  it('detects language and config flag', async () => {
    const files = [
      makeFile('Main.java', 'class Main {}', 'P/src/Main.java'),
      makeFile('build.gradle', 'apply plugin: "java"', 'P/build.gradle'),
      makeFile('README.md', '# Project', 'P/README.md'),
    ];
    const project = await discoverFromFiles(files, {
      excludedDirs: [],
      excludedExtensions: [],
      excludedFilenames: [],
      includeGlobs: [],
      excludeGlobs: [],
      includeSource: true,
      includeConfig: true,
      includeMarkdown: true,
      customExtensions: [],
    });
    const byName: Record<string, any> = {};
    for (const f of project.files) byName[f.name] = f;
    expect(byName['Main.java'].language).toBe('java');
    expect(byName['Main.java'].isConfig).toBe(false);
    expect(byName['build.gradle'].isConfig).toBe(true);
    expect(byName['build.gradle'].language).toBe('groovy');
    expect(byName['README.md'].language).toBe('markdown');
  });

  it('returns empty when no files', async () => {
    await expect(
      discoverFromFiles([], {
        excludedDirs: [],
        excludedExtensions: [],
        excludedFilenames: [],
        includeGlobs: [],
        excludeGlobs: [],
        includeSource: true,
        includeConfig: true,
        includeMarkdown: true,
        customExtensions: [],
      }),
    ).rejects.toThrow(/No files/);
  });

  it('accepts loose files (no webkitRelativePath) as a synthetic project', async () => {
    const loose = [
      new File(['class Loose {}'], 'Loose.java', { type: 'text/plain' }),
      new File(['# Notes'], 'NOTES.md', { type: 'text/plain' }),
    ];
    const project = await discoverFromFiles(loose, {
      excludedDirs: [],
      excludedExtensions: [],
      excludedFilenames: [],
      includeGlobs: [],
      excludeGlobs: [],
      includeSource: true,
      includeConfig: true,
      includeMarkdown: true,
      customExtensions: [],
    });
    expect(project.label).toBe('Loose files');
    expect(project.files).toHaveLength(2);
    expect(project.files.map((f) => f.relativePath).sort()).toEqual([
      'Loose.java',
      'NOTES.md',
    ]);
    // An informational warning about loose structure is surfaced.
    expect(
      project.warnings.some((w) => /Loose files/.test(w.message)),
    ).toBe(true);
  });

  it('keeps folder-backed files when mixed with loose ones', async () => {
    const mixed = [
      new File(['loose body'], 'loose.txt', { type: 'text/plain' }),
      makeFile('Main.java', 'class Main {}', 'P/src/Main.java'),
    ];
    const project = await discoverFromFiles(mixed, {
      excludedDirs: [],
      excludedExtensions: [],
      excludedFilenames: [],
      includeGlobs: [],
      excludeGlobs: [],
      includeSource: true,
      includeConfig: true,
      includeMarkdown: true,
      customExtensions: [],
    });
    // Folder name still derives from the first relative path.
    expect(project.folderName).toBe('P');
    const paths = project.files.map((f) => f.relativePath).sort();
    expect(paths).toEqual(['loose.txt', 'src/Main.java']);
  });

  it('throws a helpful error when every file was skipped', async () => {
    const binaryOnly = [new File(['\u0000\u0001'], 'blob.png', { type: 'image/png' })];
    await expect(
      discoverFromFiles(binaryOnly, {
        excludedDirs: [],
        excludedExtensions: [],
        excludedFilenames: [],
        includeGlobs: [],
        excludeGlobs: [],
        includeSource: true,
        includeConfig: true,
        includeMarkdown: true,
        customExtensions: [],
      }),
    ).rejects.toThrow(/No readable files/);
  });

  it('loose binary files are still excluded by extension rules', async () => {
    const loose = [
      new File(['class A {}'], 'A.java', { type: 'text/plain' }),
      new File(['\u0000data'], 'asset.zip', { type: 'application/zip' }),
    ];
    const project = await discoverFromFiles(loose, {
      excludedDirs: [],
      excludedExtensions: [],
      excludedFilenames: [],
      includeGlobs: [],
      excludeGlobs: [],
      includeSource: true,
      includeConfig: true,
      includeMarkdown: true,
      customExtensions: [],
    });
    expect(project.files).toHaveLength(1);
    expect(project.files[0].name).toBe('A.java');
  });
});

describe('formatBytes', () => {
  it('formats bytes correctly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1500)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
  });
});
