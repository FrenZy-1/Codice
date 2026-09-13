import { describe, expect, it } from 'vitest';
import {
  planSnapshot,
  buildSnapshotZip,
  type SnapshotPlan,
} from '../lib/sourceSnapshot';
import type { FileHandle, ProjectEntry } from '../types';

/** Minimal project factory. */
function mkProject(
  id: string,
  label: string,
  files: Array<{ path: string; body: string; excluded?: boolean }>,
): ProjectEntry {
  const discovered = files.map((f, i) => {
    const name = f.path.split('/').pop() ?? f.path;
    const handle: FileHandle = {
      async getText() {
        return f.body;
      },
      get file() {
        return new File([f.body], name, { type: 'text/plain' });
      },
    };
    return {
      id: `${id}-f${i}`,
      projectId: id,
      relativePath: f.path,
      name,
      directory: f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '',
      size: f.body.length,
      language: 'java',
      isConfig: false,
      binary: false,
      excluded: f.excluded ?? false,
      fileHandle: handle,
    };
  });
  return {
    id,
    label,
    folderName: label,
    files: discovered,
    selectedCount: discovered.length,
    selectedSize: discovered.reduce((s, f) => s + f.size, 0),
    warnings: [],
    addedAt: 0,
  };
}

describe('planSnapshot', () => {
  it('uses bare relative paths for a single project', () => {
    const p = mkProject('p1', 'Alpha', [
      { path: 'src/Main.java', body: 'A' },
      { path: 'README.md', body: 'B' },
    ]);
    const plan = planSnapshot([p], () => new Set(p.files.map((f) => f.id)));
    expect(plan.entries.map((e) => e.zipPath)).toEqual([
      'src/Main.java',
      'README.md',
    ]);
    expect(plan.namespaced).toBe(0);
  });

  it('namespaces paths when multiple projects contribute', () => {
    const a = mkProject('p1', 'Alpha', [{ path: 'src/Main.java', body: 'A' }]);
    const b = mkProject('p2', 'Beta', [{ path: 'src/Main.java', body: 'B' }]);
    const all = [a, b];
    const plan = planSnapshot(all, (pid) => {
      const proj = all.find((x) => x.id === pid)!;
      return new Set(proj.files.map((f) => f.id));
    });
    expect(plan.entries.map((e) => e.zipPath)).toEqual([
      'Alpha/src/Main.java',
      'Beta/src/Main.java',
    ]);
    expect(plan.namespaced).toBe(1);
  });

  it('skips excluded and unselected files', () => {
    const p = mkProject('p1', 'Alpha', [
      { path: 'keep.java', body: 'A' },
      { path: 'drop.java', body: 'B', excluded: true },
    ]);
    const onlyFirst = new Set([p.files[0].id]);
    const plan = planSnapshot([p], () => onlyFirst);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].relativePath).toBe('keep.java');
  });

  it('returns an empty plan when no project has selections', () => {
    const p = mkProject('p1', 'Alpha', [{ path: 'a.java', body: 'A' }]);
    const plan = planSnapshot([p], () => new Set());
    expect(plan.entries).toHaveLength(0);
  });
});

describe('buildSnapshotZip', () => {
  it('returns null for an empty plan', async () => {
    const plan: SnapshotPlan = { entries: [], unreadable: 0, namespaced: 0 };
    expect(await buildSnapshotZip(plan, 'test')).toBeNull();
  });

  it('builds a readable archive with the selected file contents', async () => {
    const JSZip = (await import('jszip')).default;
    const p = mkProject('p1', 'Alpha', [
      { path: 'src/Main.java', body: 'class Main {}' },
      { path: 'README.md', body: '# Hello' },
    ]);
    const plan = planSnapshot([p], () => new Set(p.files.map((f) => f.id)));
    const result = await buildSnapshotZip(plan, 'Codice_Output_sources');
    expect(result).not.toBeNull();
    expect(result!.filename).toBe('Codice_Output_sources.zip');
    expect(result!.fileCount).toBe(2);
    expect(result!.elapsedMs).toBeGreaterThanOrEqual(0);

    // Unzip and verify content.
    const zip = await JSZip.loadAsync(result!.blob);
    expect(await zip.file('src/Main.java')!.async('string')).toBe(
      'class Main {}',
    );
    expect(await zip.file('README.md')!.async('string')).toBe('# Hello');
  });

  it('reports progress per file and skips unreadable entries', async () => {
    const p = mkProject('p1', 'Alpha', [
      { path: 'good.java', body: 'ok' },
    ]);
    // Add an entry whose handle rejects.
    p.files.push({
      ...(p.files[0] as any),
      id: 'p1-bad',
      relativePath: 'bad.java',
      name: 'bad.java',
      fileHandle: {
        async getText() {
          throw new Error('unreadable');
        },
        get file() {
          throw new Error('unreadable');
        },
      },
    });
    const plan = planSnapshot(
      [p],
      () => new Set(p.files.map((f) => f.id)),
    );
    const progress: Array<[number, number, string?]> = [];
    const result = await buildSnapshotZip(plan, 'snap', (done, total, path) =>
      progress.push([done, total, path]),
    );
    expect(result).not.toBeNull();
    expect(result!.fileCount).toBe(2);
    // Progress fires per entry (before and after read).
    expect(progress.length).toBeGreaterThanOrEqual(4);
    expect(progress[0][0]).toBe(0);
    expect(progress[progress.length - 1][0]).toBe(2);
  });

  it('sanitizes unsafe archive names', async () => {
    const p = mkProject('p1', 'Alpha', [{ path: 'a.java', body: 'A' }]);
    const plan = planSnapshot([p], () => new Set(p.files.map((f) => f.id)));
    const result = await buildSnapshotZip(plan, '../../evil name!');
    expect(result!.filename).toBe('evil_name.zip');
  });
});
