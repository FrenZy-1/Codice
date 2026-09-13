import { describe, expect, it } from 'vitest';
import {
  computeBulkSelection,
  filterVisibleFiles,
  visibleIdsFor,
  totalSizeForIds,
} from '../lib/bulkSelection';
import type { DiscoveredFile } from '../types';

/** Minimal DiscoveredFile factory for filter tests. */
function mk(
  id: string,
  name: string,
  opts: Partial<DiscoveredFile> = {},
): DiscoveredFile {
  const dot = name.lastIndexOf('.');
  return {
    id,
    projectId: 'p1',
    relativePath: opts.relativePath ?? name,
    name,
    directory: '',
    size: opts.size ?? 100,
    language: 'java',
    isConfig: false,
    binary: false,
    excluded: false,
    fileHandle: {} as DiscoveredFile['fileHandle'],
    ...opts,
  };
}

describe('computeBulkSelection', () => {
  const ids = ['a', 'b', 'c'];
  const selected = new Set(['b']);

  it('all selects only the unselected visible ids', () => {
    const r = computeBulkSelection('all', ids, (id) => selected.has(id));
    expect(r.selectIds).toEqual(['a', 'c']);
    expect(r.deselectIds).toEqual([]);
  });

  it('none deselects only the selected visible ids', () => {
    const r = computeBulkSelection('none', ids, (id) => selected.has(id));
    expect(r.selectIds).toEqual([]);
    expect(r.deselectIds).toEqual(['b']);
  });

  it('invert flips every visible id', () => {
    const r = computeBulkSelection('invert', ids, (id) => selected.has(id));
    expect(r.selectIds).toEqual(['a', 'c']);
    expect(r.deselectIds).toEqual(['b']);
  });

  it('invert with nothing selected selects everything', () => {
    const r = computeBulkSelection('invert', ids, () => false);
    expect(r.selectIds).toEqual(ids);
    expect(r.deselectIds).toEqual([]);
  });

  it('all with everything selected produces no changes', () => {
    const r = computeBulkSelection('all', ids, () => true);
    expect(r.selectIds).toEqual([]);
    expect(r.deselectIds).toEqual([]);
  });

  it('handles an empty visible set', () => {
    for (const mode of ['all', 'none', 'invert'] as const) {
      const r = computeBulkSelection(mode, [], () => false);
      expect(r.selectIds).toEqual([]);
      expect(r.deselectIds).toEqual([]);
    }
  });
});

describe('filterVisibleFiles', () => {
  const files = [
    mk('1', 'Main.java', { excluded: false, relativePath: 'src/Main.java' }),
    mk('2', 'notes.md', { excluded: false, relativePath: 'docs/notes.md' }),
    mk('3', 'cache.bin', { excluded: true, relativePath: 'out/cache.bin' }),
    mk('4', 'util.java', {
      excluded: true,
      relativePath: 'src/util.java',
      name: 'util.java',
    }),
  ];

  it('hides excluded files unless explicitly included', () => {
    const visible = filterVisibleFiles(files, {
      showExcluded: false,
      extensionFilter: '',
      searchQuery: '',
      projectId: 'p1',
    });
    expect(visible.map((f) => f.id)).toEqual(['1', '2']);
  });

  it('shows an excluded file when it is in the inclusions set', () => {
    const visible = filterVisibleFiles(files, {
      showExcluded: false,
      extensionFilter: '',
      searchQuery: '',
      projectId: 'p1',
      inclusions: { p1: new Set(['3']) },
    });
    expect(visible.map((f) => f.id)).toEqual(['1', '2', '3']);
  });

  it('shows everything with showExcluded on', () => {
    const visible = filterVisibleFiles(files, {
      showExcluded: true,
      extensionFilter: '',
      searchQuery: '',
      projectId: 'p1',
    });
    expect(visible).toHaveLength(4);
  });

  it('filters by extension', () => {
    const visible = filterVisibleFiles(files, {
      showExcluded: true,
      extensionFilter: '.java',
      searchQuery: '',
      projectId: 'p1',
    });
    expect(visible.map((f) => f.id)).toEqual(['1', '4']);
  });

  it('filters by search query against the relative path', () => {
    const visible = filterVisibleFiles(files, {
      showExcluded: true,
      extensionFilter: '',
      searchQuery: 'SRC',
      projectId: 'p1',
    });
    expect(visible.map((f) => f.id)).toEqual(['1', '4']);
  });

  it('combines search + extension filters', () => {
    const visible = filterVisibleFiles(files, {
      showExcluded: true,
      extensionFilter: '.md',
      searchQuery: 'docs',
      projectId: 'p1',
    });
    expect(visible.map((f) => f.id)).toEqual(['2']);
  });
});

describe('visibleIdsFor + totalSizeForIds', () => {
  it('maps files to ids in order', () => {
    const files = [mk('x', 'a.java'), mk('y', 'b.java')];
    expect(visibleIdsFor(files)).toEqual(['x', 'y']);
  });

  it('sums sizes for the selected ids only', () => {
    const files = [
      mk('x', 'a.java', { size: 1000 }),
      mk('y', 'b.java', { size: 250 }),
      mk('z', 'c.java', { size: 750 }),
    ];
    expect(totalSizeForIds(files, new Set(['x', 'z']))).toBe(1750);
    expect(totalSizeForIds(files, new Set())).toBe(0);
  });
});
