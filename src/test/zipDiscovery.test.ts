/**
 * Tests for ZIP archive discovery (src/lib/fileDiscovery.ts →
 * discoverFromZipArchive + isZipFile).
 *
 * Archives are built in-memory with JSZip and decoded through the same
 * pipeline the browser upload path uses, so assertions cover the real
 * exclusion / language / warning behavior.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  discoverFromZipArchive,
  isZipFile,
} from '../lib/fileDiscovery';

type ZipFilter = Parameters<typeof discoverFromZipArchive>[1];

/** Permissive base filter; individual tests add exclusions as needed. */
function filter(overrides: Partial<ZipFilter> = {}): ZipFilter {
  return {
    excludedDirs: [],
    excludedExtensions: [],
    excludedFilenames: [],
    includeGlobs: [],
    excludeGlobs: [],
    includeSource: true,
    includeConfig: true,
    includeMarkdown: true,
    customExtensions: [],
    ...overrides,
  };
}

async function zipToFile(zip: JSZip, name = 'bundle.zip'): Promise<File> {
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new File([bytes as unknown as BlobPart], name, {
    type: 'application/zip',
  });
}

describe('isZipFile', () => {
  it('detects .zip by extension and by MIME type', () => {
    expect(isZipFile({ name: 'a.zip' })).toBe(true);
    expect(isZipFile({ name: 'A.ZIP' })).toBe(true);
    expect(
      isZipFile({ name: 'archive', type: 'application/zip' }),
    ).toBe(true);
    expect(isZipFile({ name: 'main.ts', type: 'text/plain' })).toBe(false);
  });
});

describe('discoverFromZipArchive', () => {
  it('uses the common top-level folder as the project label and strips it', async () => {
    const zip = new JSZip();
    const root = zip.folder('my-project')!;
    root.file('README.md', '# Hello\n');
    root.folder('src')!.file('app.ts', 'export const x = 1;\n');
    const file = await zipToFile(zip);

    const project = await discoverFromZipArchive(file, filter());
    expect(project.label).toBe('my-project');
    expect(project.folderName).toBe('my-project');
    const paths = project.files.map((f) => f.relativePath).sort();
    expect(paths).toEqual(['README.md', 'src/app.ts']);
    expect(project.selectedCount).toBe(2);
  });

  it('falls back to the archive filename when there is no common root', async () => {
    const zip = new JSZip();
    zip.file('loose.ts', 'let a = 1;\n');
    zip.file('other/main.ts', 'class Main {}\n');
    const file = await zipToFile(zip, 'flat-bundle.zip');

    const project = await discoverFromZipArchive(file, filter());
    expect(project.label).toBe('flat-bundle');
    expect(
      project.files.map((f) => f.relativePath).sort(),
    ).toEqual(['loose.ts', 'other/main.ts']);
  });

  it('applies directory + binary exclusions and reports them', async () => {
    const zip = new JSZip();
    const root = zip.folder('proj')!;
    root.file('src/keep.ts', 'export {};\n');
    root.folder('node_modules')!.file('lib.js', 'module.exports = 1;\n');
    root.file('logo.png', new Uint8Array([137, 80, 78, 71]));
    const file = await zipToFile(zip);

    const project = await discoverFromZipArchive(
      file,
      filter({ excludedDirs: ['node_modules'] }),
    );
    const paths = project.files.map((f) => f.relativePath);
    expect(paths).toEqual(['src/keep.ts']); // node_modules dropped, png ignored
    expect(project.selectedCount).toBe(1);

    const binaryWarning = project.warnings.find((w) =>
      /binary file/.test(w.message),
    );
    expect(binaryWarning).toBeDefined();
    expect(binaryWarning!.severity).toBe('info');
  });

  it('skips .DS_Store and __MACOSX metadata entries', async () => {
    const zip = new JSZip();
    const root = zip.folder('proj')!;
    root.file('main.ts', 'export {};\n');
    root.file('.DS_Store', 'junk');
    root.folder('__MACOSX')!.file('main.tsx', 'junk');
    const file = await zipToFile(zip);

    const project = await discoverFromZipArchive(file, filter());
    expect(project.files.map((f) => f.relativePath)).toEqual(['main.ts']);
  });

  it('produces working lazy file handles', async () => {
    const zip = new JSZip();
    const root = zip.folder('proj')!;
    root.file('src/app.ts', 'export const answer = 42;\n');
    const file = await zipToFile(zip);

    const project = await discoverFromZipArchive(file, filter());
    const app = project.files.find((f) => f.name === 'app.ts')!;
    expect(app.fileHandle).toBeDefined();
    const text = await app.fileHandle!.getText();
    expect(text).toContain('answer = 42');
    // Second read is served from cache and still matches.
    expect(await app.fileHandle!.getText()).toBe(text);
  });

  it('reports progress while unpacking', async () => {
    const zip = new JSZip();
    const root = zip.folder('proj')!;
    root.file('a.ts', '1;\n');
    root.file('b.ts', '2;\n');
    root.file('c.ts', '3;\n');
    const file = await zipToFile(zip);

    const seen: number[] = [];
    await discoverFromZipArchive(file, filter(), (count) => seen.push(count));
    expect(seen).toEqual([1, 2, 3]);
  });

  it('rejects corrupt archives with a helpful message', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'broken.zip', {
      type: 'application/zip',
    });
    await expect(discoverFromZipArchive(file, filter())).rejects.toThrow(
      /broken\.zip/,
    );
  });

  it('rejects an archive that only contains excluded content', async () => {
    const zip = new JSZip();
    zip.folder('proj')!.folder('node_modules')!.file('x.js', '1;\n');
    const file = await zipToFile(zip);
    await expect(
      discoverFromZipArchive(file, filter({ excludedDirs: ['node_modules'] })),
    ).rejects.toThrow(/No readable files/);
  });
});
