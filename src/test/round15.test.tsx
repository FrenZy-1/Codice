/**
 * R15 regression tests — this round's features (two completed from the
 * interrupted session, one new, plus the styling/UX details):
 *
 *   1. DUPLICATE_EXPORT_GROUP reducer: full scaffold copy inserted right
 *      after the source, fresh id, "(copy)" / "(copy 2)" naming with
 *      case-insensitive dedup, optional pre-generated newId honored
 *      (the panel flashes the fresh row), unknown id = no-op.
 *   2. MOVE_PROJECT_BETWEEN_GROUPS reducer: cross-group chip move with
 *      full guards (same group / missing groups / id not in source /
 *      already in target → silent no-op; appends to the target).
 *   3. exportHistoryStorage: IndexedDB persistence for export history —
 *      round-trip (blob preserved, object URL regenerated), corrupt /
 *      future-schema records skipped on load, cap (oldest dropped),
 *      save REPLACES the store, entries without a blob skipped, no
 *      indexedDB → silent no-ops, clear wipes.
 *   4. ExportPanel wiring: mount restores persisted history ("Recent
 *      exports" appears with the saved entry; clicking a row downloads
 *      it again); BUG-009 regression — the groups stepper renders with
 *      a SINGLE project in groups mode (was hidden for <2 projects);
 *      the duplicate button adds a "(copy)" group and flashes the fresh
 *      row; cross-group chip drops (on the row AND on a chip) move the
 *      project; a cross-group drop marks the row as a MOVE target
 *      (data-drop-kind) — the styling distinguishes move from assign.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { AppStateProvider, reducer, useAppState } from '@/hooks/useAppState';
import type { AppState } from '@/hooks/useAppState';
import { ToastProvider } from '@/components/common/Toast';
import { ExportPanel } from '@/components/ExportPanel';
import {
  saveExportHistory,
  loadExportHistory,
  clearExportHistory,
  MAX_HISTORY,
} from '@/lib/exportHistoryStorage';
import { createHistoryEntry, type ExportHistoryEntry } from '@/lib/exportHistory';
import type { ExportGroup, ProjectEntry } from '@/types';

/* ------------------------------------------------------------------ */
/* Factories                                                           */
/* ------------------------------------------------------------------ */

function makeProject(id: string, label: string): ProjectEntry {
  return {
    id,
    label,
    folderName: label,
    files: [
      {
        id: `${id}-f1`,
        projectId: id,
        relativePath: 'Main.kt',
        name: 'Main.kt',
        directory: '',
        size: 10,
        language: 'kotlin',
        isConfig: false,
        binary: false,
        excluded: false,
      },
    ],
    selectedCount: 1,
    selectedSize: 10,
    warnings: [],
    addedAt: 1,
  };
}

function group(id: string, name: string, projectIds: string[]): ExportGroup {
  return { id, name, projectIds };
}

/** Build a fully-formed history entry (via the factory under test). */
function makeEntry(overrides: {
  id?: string;
  filename?: string;
  format?: ExportHistoryEntry['format'];
  at?: number;
  detail?: string;
  content?: string;
}): ExportHistoryEntry {
  const blob = new Blob([overrides.content ?? 'x'.repeat(10)], {
    type: 'application/octet-stream',
  });
  const entry = createHistoryEntry({
    blob,
    filename: overrides.filename ?? 'Doc.docx',
    format: overrides.format ?? 'docx',
    elapsedMs: 42,
    detail: overrides.detail,
    now: overrides.at,
  });
  return overrides.id ? { ...entry, id: overrides.id } : entry;
}

/* ------------------------------------------------------------------ */
/* 1. DUPLICATE_EXPORT_GROUP (reducer)                                 */
/* ------------------------------------------------------------------ */

describe('DUPLICATE_EXPORT_GROUP (reducer)', () => {
  const source: ExportGroup = {
    id: 'g1',
    name: 'Client A',
    projectIds: ['p1', 'p2'],
    layoutId: 'layout-x',
    firstPage: 'cover',
    coverId: 'cov-1',
    filename: 'A_{group}',
  };
  const other: ExportGroup = { id: 'g2', name: 'B', projectIds: ['p3'] };
  const state = { exportGroups: [source, other] } as unknown as AppState;

  it('inserts a full scaffold copy right after the source', () => {
    const next = reducer(state, { type: 'DUPLICATE_EXPORT_GROUP', id: 'g1' });
    expect(next.exportGroups).toHaveLength(3);
    const copy = next.exportGroups[1];
    expect(copy.id).not.toBe('g1');
    expect(copy.name).toBe('Client A (copy)');
    // Every per-export setting carries over…
    expect(copy.layoutId).toBe('layout-x');
    expect(copy.firstPage).toBe('cover');
    expect(copy.coverId).toBe('cov-1');
    expect(copy.filename).toBe('A_{group}');
    // …and the project list is a COPY, not an alias.
    expect(copy.projectIds).toEqual(['p1', 'p2']);
    expect(copy.projectIds).not.toBe(source.projectIds);
    // The source row is untouched; the other group keeps its identity.
    expect(next.exportGroups[0]).toBe(source);
    expect(next.exportGroups[2]).toBe(other);
  });

  it('numbers onward when "(copy)" is taken (case-insensitive)', () => {
    const withCopy = {
      exportGroups: [source, { id: 'g3', name: 'client A (copy)', projectIds: [] }],
    } as unknown as AppState;
    const next = reducer(withCopy, { type: 'DUPLICATE_EXPORT_GROUP', id: 'g1' });
    // The copy is inserted at index 1 (right after the source) and skips
    // the taken name (case-insensitive) to "Client A (copy 2)".
    expect(next.exportGroups[1].name).toBe('Client A (copy 2)');
  });

  it('honors a pre-generated newId (the panel flashes the fresh row)', () => {
    const next = reducer(state, {
      type: 'DUPLICATE_EXPORT_GROUP',
      id: 'g1',
      newId: 'grp-fresh',
    });
    expect(next.exportGroups[1].id).toBe('grp-fresh');
  });

  it('is a no-op for an unknown source id', () => {
    const next = reducer(state, { type: 'DUPLICATE_EXPORT_GROUP', id: 'missing' });
    expect(next).toBe(state);
  });
});

/* ------------------------------------------------------------------ */
/* 2. MOVE_PROJECT_BETWEEN_GROUPS (reducer)                            */
/* ------------------------------------------------------------------ */

describe('MOVE_PROJECT_BETWEEN_GROUPS (reducer)', () => {
  const g1 = group('g1', 'A', ['p1', 'p2']);
  const g2 = group('g2', 'B', ['p3']);
  const state = { exportGroups: [g1, g2] } as unknown as AppState;

  it('removes from the source and APPENDS to the target', () => {
    const next = reducer(state, {
      type: 'MOVE_PROJECT_BETWEEN_GROUPS',
      fromGroupId: 'g1',
      toGroupId: 'g2',
      projectId: 'p1',
    });
    expect(next.exportGroups[0].projectIds).toEqual(['p2']);
    expect(next.exportGroups[1].projectIds).toEqual(['p3', 'p1']);
  });

  it('is a no-op when both ids are the same group', () => {
    const next = reducer(state, {
      type: 'MOVE_PROJECT_BETWEEN_GROUPS',
      fromGroupId: 'g1',
      toGroupId: 'g1',
      projectId: 'p1',
    });
    expect(next).toBe(state);
  });

  it('is a no-op when a group is missing (stale drag)', () => {
    for (const [from, to] of [
      ['missing', 'g2'],
      ['g1', 'missing'],
    ]) {
      const next = reducer(state, {
        type: 'MOVE_PROJECT_BETWEEN_GROUPS',
        fromGroupId: from,
        toGroupId: to,
        projectId: 'p1',
      });
      expect(next).toBe(state);
    }
  });

  it('is a no-op when the id is not in the source', () => {
    const next = reducer(state, {
      type: 'MOVE_PROJECT_BETWEEN_GROUPS',
      fromGroupId: 'g1',
      toGroupId: 'g2',
      projectId: 'p3',
    });
    expect(next).toBe(state);
  });

  it('is a no-op when the id is already in the target', () => {
    const shared = { exportGroups: [g1, group('g2', 'B', ['p1'])] } as unknown as AppState;
    const next = reducer(shared, {
      type: 'MOVE_PROJECT_BETWEEN_GROUPS',
      fromGroupId: 'g1',
      toGroupId: 'g2',
      projectId: 'p1',
    });
    expect(next).toBe(shared);
  });
});

/* ------------------------------------------------------------------ */
/* 3. exportHistoryStorage (fake IndexedDB)                            */
/* ------------------------------------------------------------------ */

const STORE_NAME = 'exports';

/** Minimal synchronous-enough IndexedDB fake (jsdom has none). Requests
 * fire their success event as a microtask, so handlers attached right
 * after a call observe them — plain `await` flushes everything. */
function installFakeIndexedDB(): void {
  const backing = new Map<string, unknown>();
  class FakeRequest<T> {
    result: T | undefined = undefined;
    error: Error | null = null;
    onsuccess: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    succeed(v: T): void {
      this.result = v;
      queueMicrotask(() => this.onsuccess?.({ type: 'success', target: this }));
    }
    fail(e: Error): void {
      this.error = e;
      queueMicrotask(() => this.onerror?.({ type: 'error', target: this }));
    }
  }
  const store = {
    clear: () => {
      const req = new FakeRequest<undefined>();
      backing.clear();
      req.succeed(undefined);
      return req;
    },
    put: (record: { id: string }) => {
      const req = new FakeRequest<string>();
      backing.set(record.id, record);
      req.succeed(record.id);
      return req;
    },
    getAll: () => {
      const req = new FakeRequest<unknown[]>();
      req.succeed(Array.from(backing.values()));
      return req;
    },
  };
  const db = {
    objectStoreNames: { contains: (n: string) => n === STORE_NAME },
    // Other storage modules (covers/images) open their own databases
    // against the same fake — their upgrade handler may create stores.
    createObjectStore: () => ({}),
    transaction: () => ({ objectStore: () => store }),
  };
  const factory = {
    open: (_name: string, _version: number) => {
      const req = new FakeRequest<typeof db>() as unknown as {
        result?: typeof db;
        onupgradeneeded: ((e: unknown) => void) | null;
        onsuccess: ((e: unknown) => void) | null;
        onerror: ((e: unknown) => void) | null;
        onblocked: ((e: unknown) => void) | null;
        succeed: (v: typeof db) => void;
        fail: (e: Error) => void;
      };
      req.onupgradeneeded = null;
      req.onsuccess = null;
      req.onerror = null;
      req.onblocked = null;
      req.succeed = (v) => {
        // result is available DURING upgradeneeded (real IDB semantics);
        // upgrade fires before success, both as ordered microtasks.
        req.result = v;
        queueMicrotask(() => req.onupgradeneeded?.({ type: 'upgradeneeded', target: req }));
        queueMicrotask(() => req.onsuccess?.({ type: 'success', target: req }));
      };
      req.fail = (e) => {
        queueMicrotask(() => req.onerror?.({ type: 'error', target: req }));
      };
      req.succeed(db);
      return req;
    },
  };
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: factory,
  });
}

describe('exportHistoryStorage (fake IndexedDB)', () => {
  beforeAll(() => {
    installFakeIndexedDB();
    // jsdom lacks object-URL creation (mirrors exportHistory.test.ts).
    let created = 0;
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => {
      created += 1;
      return `blob:fake-${created}`;
    };
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {};
  });

  beforeEach(async () => {
    await clearExportHistory();
  });

  it('round-trips metadata AND the blob (object URL regenerated fresh)', async () => {
    const e1 = makeEntry({ id: 'exh-1', filename: 'Alpha.docx', at: 2000, detail: 'group: A' });
    const e2 = makeEntry({ id: 'exh-2', filename: 'Beta.pdf', format: 'pdf', at: 1000 });
    await saveExportHistory([e1, e2]);
    const loaded = await loadExportHistory();
    expect(loaded.map((e) => e.id)).toEqual(['exh-1', 'exh-2']); // newest (at) first
    const first = loaded[0];
    expect(first.filename).toBe('Alpha.docx');
    expect(first.format).toBe('docx');
    expect(first.sizeBytes).toBe(e1.sizeBytes);
    expect(first.at).toBe(2000);
    expect(first.detail).toBe('group: A');
    expect(first.url).toMatch(/^blob:fake-/);
    expect(first.url).not.toBe(e1.url); // URL is session-specific, regenerated
    expect(first.blob).toBeInstanceOf(Blob);
    expect(await first.blob.text()).toBe('x'.repeat(10));
    expect(await loaded[1].blob.text()).toBe('x'.repeat(10));
  });

  it('skips corrupt and future-schema records on load', async () => {
    await saveExportHistory([makeEntry({ id: 'ok-1' })]);
    // Corrupt + future-schema records land in the store out-of-band.
    const req = window.indexedDB.open('codice-history', 1);
    await waitFor(() => expect(req.result).toBeTruthy());
    const tx = req.result.transaction('exports', 'readwrite');
    const store = tx.objectStore('exports');
    store.put({ schemaVersion: 1, id: 'bad', filename: '' }); // missing fields
    store.put({ schemaVersion: 99, id: 'fut', filename: 'From the future.docx' });
    await new Promise((r) => setTimeout(r, 0));
    const loaded = await loadExportHistory();
    expect(loaded.map((e) => e.id)).toEqual(['ok-1']);
  });

  it('caps on load: beyond MAX_HISTORY the oldest entries are dropped', async () => {
    const entries: ExportHistoryEntry[] = [];
    for (let i = 0; i < MAX_HISTORY + 2; i += 1) {
      entries.push(makeEntry({ id: `exh-${i}`, at: i * 10 }));
    }
    await saveExportHistory(entries);
    const loaded = await loadExportHistory();
    expect(loaded).toHaveLength(MAX_HISTORY);
    // Newest five kept: exh-6 … exh-2 (exh-0 and exh-1 are the oldest).
    expect(loaded.map((e) => e.id)).toEqual([
      'exh-6',
      'exh-5',
      'exh-4',
      'exh-3',
      'exh-2',
    ]);
  });

  it('save REPLACES the store (removals propagate)', async () => {
    await saveExportHistory([makeEntry({ id: 'a' }), makeEntry({ id: 'b' })]);
    await saveExportHistory([makeEntry({ id: 'c' })]);
    const loaded = await loadExportHistory();
    expect(loaded.map((e) => e.id)).toEqual(['c']);
  });

  it('skips entries without a blob (defensive) on save', async () => {
    const noBlob = { ...makeEntry({ id: 'ghost' }), blob: undefined } as unknown as ExportHistoryEntry;
    await saveExportHistory([noBlob, makeEntry({ id: 'real' })]);
    const loaded = await loadExportHistory();
    expect(loaded.map((e) => e.id)).toEqual(['real']);
  });

  it('clear wipes the store', async () => {
    await saveExportHistory([makeEntry({ id: 'a' })]);
    await clearExportHistory();
    expect(await loadExportHistory()).toEqual([]);
  });

  it('degrades to silent no-ops without indexedDB', async () => {
    vi.resetModules();
    const original = (window as unknown as { indexedDB?: IDBFactory }).indexedDB;
    delete (window as unknown as { indexedDB?: IDBFactory }).indexedDB;
    try {
      const mod = await import('@/lib/exportHistoryStorage');
      await expect(mod.loadExportHistory()).resolves.toEqual([]);
      await expect(mod.saveExportHistory([])).resolves.toBeUndefined();
      await expect(mod.clearExportHistory()).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        value: original,
      });
    }
  });
});

/* ------------------------------------------------------------------ */
/* 4. ExportPanel wiring                                               */
/* ------------------------------------------------------------------ */

function SeedOnce({
  dispatch,
  actions,
}: {
  dispatch: ReturnType<typeof useAppState>['dispatch'];
  actions: unknown[];
}) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    for (const action of actions) dispatch(action as never);
  }, [dispatch, actions]);
  return null;
}

function PanelProbe({ actions }: { actions: unknown[] }) {
  const { dispatch } = useAppState();
  return (
    <>
      <SeedOnce dispatch={dispatch} actions={actions} />
      <ExportPanel />
    </>
  );
}

function withProviders(ui: React.ReactNode) {
  return (
    <ToastProvider>
      <AppStateProvider>{ui}</AppStateProvider>
    </ToastProvider>
  );
}

describe('ExportPanel: history restore (mount)', () => {
  beforeAll(() => {
    installFakeIndexedDB();
    let created = 100;
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => {
      created += 1;
      return `blob:fake-${created}`;
    };
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {};
  });

  afterEach(() => {
    cleanup();
  });

  it('restores persisted entries on mount and re-downloads on click', async () => {
    await clearExportHistory();
    await saveExportHistory([makeEntry({ id: 'restored-1', filename: 'Saved.docx' })]);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    render(withProviders(<PanelProbe actions={[{ type: 'SET_OUTPUT_MODE', mode: 'groups' }]} />));
    // The persisted entry reappears after the (async) hydration.
    await waitFor(() => expect(screen.getByText('Recent exports')).toBeTruthy());
    // History is an accordion — open it, then re-download the entry.
    fireEvent.click(screen.getByText('Recent exports'));
    const row = await screen.findByTitle('Download Saved.docx again');
    fireEvent.click(row);
    expect(clickSpy).toHaveBeenCalled();
    await clearExportHistory();
    clickSpy.mockRestore();
  });
});

describe('ExportPanel: duplicate + BUG-009 + cross-group chip move', () => {
  beforeAll(() => {
    // ExportPanel's debounced save touches IDB — install the fake so the
    // test never depends on the environment.
    installFakeIndexedDB();
    let created = 200;
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => {
      created += 1;
      return `blob:fake-${created}`;
    };
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {};
  });

  afterEach(() => {
    cleanup();
  });

  it('BUG-009 regression: the stepper renders with ONE project in groups mode', () => {
    const actions = [
      { type: 'ADD_PROJECT', project: makeProject('p1', 'Alpha') },
      { type: 'SET_OUTPUT_MODE', mode: 'groups' },
    ];
    render(withProviders(<PanelProbe actions={actions} />));
    expect(screen.getByText('Number of export files')).toBeTruthy();
  });

  it('duplicate button: adds "(copy)" right under the source and flashes it', () => {
    const actions = [
      { type: 'ADD_PROJECT', project: makeProject('p1', 'Alpha') },
      { type: 'ADD_EXPORT_GROUP', group: group('g1', 'Client A', ['p1']) },
      { type: 'SET_OUTPUT_MODE', mode: 'groups' },
    ];
    render(withProviders(<PanelProbe actions={actions} />));
    expect(screen.getByText('Client A')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Duplicate group Client A'));
    const copyName = screen.getByText('Client A (copy)');
    expect(copyName).toBeTruthy();
    // The fresh row is flashed so the user can tell copy from source.
    expect(document.querySelector('.codice-group-row.codice-row-flash')).toBeTruthy();
  });

  function chipDataTransfer(): DataTransfer {
    const dt = {
      types: ['application/x-codice-chip'],
      getData: () => '',
      setData: vi.fn(),
      dropEffect: '',
      effectAllowed: '',
    };
    return dt as unknown as DataTransfer;
  }

  const twoGroups = [
    { type: 'ADD_PROJECT', project: makeProject('p1', 'Alpha') },
    { type: 'ADD_PROJECT', project: makeProject('p2', 'Beta') },
    { type: 'ADD_PROJECT', project: makeProject('p3', 'Gamma') },
    { type: 'ADD_EXPORT_GROUP', group: group('g1', 'First', ['p1', 'p2']) },
    { type: 'ADD_EXPORT_GROUP', group: group('g2', 'Second', ['p3']) },
    { type: 'SET_OUTPUT_MODE', mode: 'groups' },
  ];

  function rows(): HTMLElement[] {
    return Array.from(document.querySelectorAll('li.codice-group-row'));
  }

  function chipOrder(): string[] {
    const first = screen.getByTestId('group-chip-g1-p1');
    const wrap = first.parentElement!;
    return Array.from(
      wrap.querySelectorAll<HTMLElement>('[data-testid^="group-chip-"]'),
    ).map((el) => el.getAttribute('data-testid') ?? '');
  }

  it('cross-group chip drop ON THE ROW moves the project (append)', () => {
    render(withProviders(<PanelProbe actions={twoGroups} />));
    const dt = chipDataTransfer();
    fireEvent.dragStart(screen.getByTestId('group-chip-g1-p1'), { dataTransfer: dt });
    fireEvent.drop(rows()[1], { dataTransfer: dt });
    // g1 lost Alpha; g2 appended it (order = arrival).
    expect(screen.queryByTestId('group-chip-g1-p1')).toBeNull();
    expect(screen.getByTestId('group-chip-g2-p1')).toBeTruthy();
    expect(screen.getByTestId('group-chip-g2-p3')).toBeTruthy();
  });

  it('cross-group chip drop ON A CHIP moves too (chip handlers own it)', () => {
    render(withProviders(<PanelProbe actions={twoGroups} />));
    const dt = chipDataTransfer();
    fireEvent.dragStart(screen.getByTestId('group-chip-g1-p1'), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('group-chip-g2-p3'), { dataTransfer: dt });
    expect(screen.queryByTestId('group-chip-g1-p1')).toBeNull();
    expect(screen.getByTestId('group-chip-g2-p1')).toBeTruthy();
  });

  it('same-group chip drops on the row are still ignored (row guard)', () => {
    render(withProviders(<PanelProbe actions={twoGroups} />));
    const dt = chipDataTransfer();
    const before = chipOrder();
    fireEvent.dragStart(screen.getByTestId('group-chip-g1-p1'), { dataTransfer: dt });
    fireEvent.drop(rows()[0], { dataTransfer: dt });
    expect(chipOrder()).toEqual(before);
  });

  it('a cross-group chip dragover marks the row as a MOVE target (data-drop-kind)', () => {
    render(withProviders(<PanelProbe actions={twoGroups} />));
    const dt = chipDataTransfer();
    fireEvent.dragStart(screen.getByTestId('group-chip-g1-p1'), { dataTransfer: dt });
    fireEvent.dragOver(rows()[1], { dataTransfer: dt });
    const row = rows()[1];
    expect(row.getAttribute('data-drop-kind')).toBe('move');
    expect(row.className).toContain('codice-group-drop-target');
  });
});
