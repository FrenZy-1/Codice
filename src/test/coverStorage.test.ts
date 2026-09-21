/**
 * WS-8a — cover-page asset persistence (IndexedDB) tests.
 *
 * Covers:
 *   - round-trip save/load with Uint8Array media bytes (and full-asset
 *     fidelity: rels, namespaces, page geometry, order by addedAt)
 *   - rehydration of media bytes stored as plain number arrays /
 *     ArrayBuffers (defensive legacy forms)
 *   - save REPLACES the stored list → removals propagate
 *   - corrupt records and future-schema records are skipped on load
 *   - caps: at most 20 covers (oldest dropped first) and a ~50 MB
 *     estimated total-size cap (enforceCoverCaps, oldest dropped first)
 *   - WS-9b: saveCoverAssets REPORTS the caps-dropped assets — the
 *     oldest-by-addedAt victims in input order; [] when under caps /
 *     storage off / corrupt-only input / failed transaction
 *   - clearCoverAssets wipes the store
 *   - missing `indexedDB` → every function resolves as a no-op
 *   - RESTORE_COVER_PAGES only fills an EMPTY list (reducer, driven
 *     directly) and never clobbers an in-session import
 *   - AppStateProvider mounts → covers restored from IndexedDB
 *
 * jsdom does not implement IndexedDB, so this file installs a minimal
 * in-memory fake on globalThis/window BEFORE any production call. The
 * fake is deterministic: mutations apply in call order, request events
 * fire as microtasks (so handlers attached right after a call still
 * observe them), and `open()` runs its upgrade/success events in a
 * queued microtask. No fake timers needed — plain `await` flushes
 * everything.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import {
  saveCoverAssets,
  loadCoverAssets,
  clearCoverAssets,
  enforceCoverCaps,
  MAX_COVERS,
  MAX_TOTAL_BYTES,
} from '@/lib/coverStorage';
import type { CoverPageAsset } from '@/types';
import { AppStateProvider, reducer, useAppState } from '@/hooks/useAppState';
import type { AppState } from '@/hooks/useAppState';

/* ------------------------------------------------------------------ */
/* Minimal fake IndexedDB (jsdom has none)                             */
/* ------------------------------------------------------------------ */

function fakeEvent(type: string, target: unknown): Event {
  return { type, target } as unknown as Event;
}

/** Deep-clone records on put, like the real engine — but keeping typed
 * arrays in THIS realm: the environment's structuredClone (jsdom's) returns
 * cross-realm Uint8Arrays that production `instanceof` checks would reject. */
function cloneValue(v: unknown): unknown {
  if (v instanceof Uint8Array) return Uint8Array.from(v);
  if (Array.isArray(v)) return v.map(cloneValue);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(v)) out[key] = cloneValue(value);
    return out;
  }
  return v;
}

class FakeRequest<T = unknown> {
  result: T | undefined = undefined;
  error: Error | null = null;
  onsuccess: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  /** Fire the success event — only ever called from a queued microtask,
   * so handlers attached right after the issuing call are in place. */
  succeed(value: T): void {
    this.result = value;
    if (this.onsuccess) this.onsuccess(fakeEvent('success', this));
  }

  fail(error: Error): void {
    this.error = error;
    if (this.onerror) this.onerror(fakeEvent('error', this));
  }
}

class FakeOpenRequest extends FakeRequest<FakeDatabase> {
  onupgradeneeded: ((ev: Event) => void) | null = null;

  upgrade(db: FakeDatabase): void {
    // The db is already exposed on the request during upgrade (real IDB).
    this.result = db;
    if (this.onupgradeneeded) this.onupgradeneeded(fakeEvent('upgradeneeded', this));
  }
}

class FakeObjectStore {
  readonly records = new Map<string, unknown>();

  constructor(
    readonly name: string,
    readonly keyPath: string | string[] | null,
  ) {}

  private keyOf(value: unknown): string {
    if (!value || typeof value !== 'object') {
      throw new Error('DataError: stored value must be an object');
    }
    const key = (value as Record<string, unknown>)['id'];
    if (typeof key !== 'string' && typeof key !== 'number') {
      throw new Error('DataError: keyPath "id" missing on record');
    }
    return String(key);
  }

  put(value: unknown): FakeRequest<IDBValidKey> {
    const req = new FakeRequest<IDBValidKey>();
    queueMicrotask(() => {
      try {
        const key = this.keyOf(value);
        this.records.set(key, cloneValue(value));
        req.succeed(key);
      } catch (err) {
        req.fail(err instanceof Error ? err : new Error(String(err)));
      }
    });
    return req;
  }

  get(key: IDBValidKey): FakeRequest<unknown> {
    const req = new FakeRequest<unknown>();
    queueMicrotask(() => req.succeed(this.records.get(String(key))));
    return req;
  }

  getAll(): FakeRequest<unknown[]> {
    const req = new FakeRequest<unknown[]>();
    queueMicrotask(() => req.succeed([...this.records.values()]));
    return req;
  }

  delete(key: IDBValidKey): FakeRequest<undefined> {
    const req = new FakeRequest<undefined>();
    queueMicrotask(() => {
      this.records.delete(String(key));
      req.succeed(undefined);
    });
    return req;
  }

  clear(): FakeRequest<undefined> {
    const req = new FakeRequest<undefined>();
    queueMicrotask(() => {
      this.records.clear();
      req.succeed(undefined);
    });
    return req;
  }
}

class FakeTransaction {
  constructor(private readonly stores: FakeObjectStore[]) {}

  objectStore(name: string): FakeObjectStore {
    const store = this.stores.find((s) => s.name === name);
    if (!store) throw new Error(`NotFoundError: no store ${name}`);
    return store;
  }
}

class FakeDatabase {
  readonly stores = new Map<string, FakeObjectStore>();
  readonly objectStoreNames: { contains: (name: string) => boolean };
  private closed = false;

  constructor(readonly name: string) {
    this.objectStoreNames = {
      contains: (storeName: string) => this.stores.has(storeName),
    };
  }

  createObjectStore(
    storeName: string,
    options?: { keyPath?: string | string[] },
  ): FakeObjectStore {
    if (this.stores.has(storeName)) {
      throw new Error(`ConstraintError: store ${storeName} already exists`);
    }
    if (this.closed) throw new Error('InvalidStateError: database is closed');
    const store = new FakeObjectStore(storeName, options?.keyPath ?? null);
    this.stores.set(storeName, store);
    return store;
  }

  transaction(storeNames: string | string[]): FakeTransaction {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    if (this.closed) throw new Error('InvalidStateError: database is closed');
    for (const n of names) {
      if (!this.stores.has(n)) throw new Error(`NotFoundError: no store ${n}`);
    }
    return new FakeTransaction(names.map((n) => this.stores.get(n)!));
  }

  close(): void {
    this.closed = true;
  }
}

class FakeIDBFactory {
  private readonly dbs = new Map<string, { db: FakeDatabase; version: number }>();

  open(name: string, version?: number): FakeOpenRequest {
    const req = new FakeOpenRequest();
    queueMicrotask(() => {
      const existing = this.dbs.get(name);
      if (existing && version !== undefined && version < existing.version) {
        req.fail(new Error(`VersionError: ${version} < ${existing.version}`));
        return;
      }
      let db: FakeDatabase;
      let needsUpgrade = false;
      if (existing) {
        db = existing.db;
        if (version !== undefined && version > existing.version) {
          existing.version = version;
          needsUpgrade = true;
        }
      } else {
        db = new FakeDatabase(name);
        this.dbs.set(name, { db, version: version ?? 1 });
        needsUpgrade = true;
      }
      if (needsUpgrade) req.upgrade(db);
      req.succeed(db);
    });
    return req;
  }

  /* ---- test helpers (not part of the IDB surface) ---- */

  /** Wipe every record of every store, keeping the schema. */
  reset(): void {
    for (const { db } of this.dbs.values()) {
      for (const store of db.stores.values()) store.records.clear();
    }
  }

  /** Raw record map of a named store — lets tests inject junk directly. */
  rawRecords(dbName: string, storeName: string): Map<string, unknown> {
    const store = this.dbs.get(dbName)?.db.stores.get(storeName);
    if (!store) throw new Error(`fake idb: no store ${dbName}/${storeName}`);
    return store.records;
  }
}

// Install BEFORE any production call (module scope, file-local environment).
const fakeIndexedDB = new FakeIDBFactory();
(window as unknown as { indexedDB: IDBFactory }).indexedDB =
  fakeIndexedDB as unknown as IDBFactory;
(globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB =
  fakeIndexedDB as unknown as IDBFactory;

/** Run `fn` with the fake IndexedDB removed (SSR / old-browser guard). */
async function withoutIndexedDB<T>(fn: () => Promise<T>): Promise<T> {
  const w = window as unknown as { indexedDB?: IDBFactory };
  const g = globalThis as unknown as { indexedDB?: IDBFactory };
  const savedWindow = w.indexedDB;
  const savedGlobal = g.indexedDB;
  delete w.indexedDB;
  delete g.indexedDB;
  try {
    return await fn();
  } finally {
    if (savedWindow !== undefined) w.indexedDB = savedWindow;
    if (savedGlobal !== undefined) g.indexedDB = savedGlobal;
  }
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

let coverSeq = 0;

function makeCover(overrides: Partial<CoverPageAsset> = {}): CoverPageAsset {
  coverSeq += 1;
  return {
    id: `cover-${coverSeq}`,
    name: `Cover ${coverSeq}`,
    fileName: `cover-${coverSeq}.docx`,
    addedAt: coverSeq,
    truncated: false,
    bodyXml: `<w:p><w:r><w:t>Cover ${coverSeq}</w:t></w:r></w:p>`,
    media: [
      { relId: 'rId5', partPath: 'word/media/image1.png', bytes: Uint8Array.from([1, 2, 3, 255]) },
    ],
    rels: [
      {
        id: 'rId5',
        target: 'media/image1.png',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
      },
    ],
    styleIds: ['Title'],
    numberingIds: [],
    stylesInner: '<w:styles/>',
    numberingInner: '',
    pageCount: 1,
    ...overrides,
  };
}

const coverA = makeCover({ id: 'a', name: 'Cover A', addedAt: 1 });
const coverB = makeCover({ id: 'b', name: 'Cover B', addedAt: 2 });

beforeEach(() => {
  fakeIndexedDB.reset();
  window.localStorage.clear();
});

afterEach(cleanup);

/* ------------------------------------------------------------------ */
/* Storage round-trip + guards                                         */
/* ------------------------------------------------------------------ */

describe('coverStorage (WS-8a)', () => {
  it('round-trips cover assets with Uint8Array media bytes', async () => {
    const a = makeCover({ id: 'rt-a', addedAt: 10 });
    const b = makeCover({
      id: 'rt-b',
      addedAt: 20,
      media: [],
      namespaces: [{ prefix: 'wp', uri: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing' }],
      pageWidthMm: 210,
      pageHeightMm: 297,
      marginTopMm: 25,
      truncated: true,
      pageCount: 3,
    });
    await saveCoverAssets([a, b]);

    const loaded = await loadCoverAssets();
    // Library order is by addedAt, regardless of getAll()'s key order.
    expect(loaded.map((c) => c.id)).toEqual(['rt-a', 'rt-b']);
    // Byte-level fidelity of the binary media.
    const bytes = loaded[0].media[0].bytes;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 255]);
    // Whole-asset fidelity (rels, style ids, raw XML, flags…).
    expect(loaded[0]).toEqual(a);
    expect(loaded[1]).toEqual(b);
    expect(loaded[1].namespaces).toEqual([
      { prefix: 'wp', uri: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing' },
    ]);
    expect(loaded[1].pageWidthMm).toBe(210);
  });

  it('rehydrates media bytes stored as plain number arrays or ArrayBuffers', async () => {
    const raw = fakeIndexedDB.rawRecords('codice-covers', 'covers');
    const base = makeCover({ id: 'legacy-arr', addedAt: 1 });
    raw.set('legacy-arr', {
      id: 'legacy-arr',
      v: 1,
      cover: { ...base, media: [{ relId: 'rId1', partPath: 'x.png', bytes: [10, 20, 30] }] },
    });
    raw.set('legacy-buf', {
      id: 'legacy-buf',
      v: 1,
      cover: {
        ...base,
        id: 'legacy-buf',
        media: [{ relId: 'rId1', partPath: 'x.png', bytes: new Uint8Array([7, 8]).buffer }],
      },
    });

    const loaded = await loadCoverAssets();
    const byId = new Map(loaded.map((c) => [c.id, c]));
    expect(loaded).toHaveLength(2);
    const arr = byId.get('legacy-arr')?.media[0].bytes;
    expect(arr).toBeInstanceOf(Uint8Array);
    expect(Array.from(arr as Uint8Array)).toEqual([10, 20, 30]);
    const buf = byId.get('legacy-buf')?.media[0].bytes;
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(Array.from(buf as Uint8Array)).toEqual([7, 8]);
  });

  it('save REPLACES the stored list — removals propagate', async () => {
    const keep = makeCover({ id: 'keep-a', addedAt: 1 });
    const drop = makeCover({ id: 'drop-b', addedAt: 2 });
    await saveCoverAssets([keep, drop]);
    await saveCoverAssets([keep]); // REMOVE_COVER_PAGE followed by the effect
    const loaded = await loadCoverAssets();
    expect(loaded.map((c) => c.id)).toEqual(['keep-a']);
  });

  it('skips corrupt and future-schema records but keeps valid ones', async () => {
    await saveCoverAssets([makeCover({ id: 'good', addedAt: 1 })]);
    const raw = fakeIndexedDB.rawRecords('codice-covers', 'covers');
    raw.set('bad-string', 'not-an-object');
    raw.set('bad-partial', { id: 'bad-partial', v: 1, cover: { id: 'bad-partial' } });
    raw.set('bad-null-cover', { id: 'bad-null-cover', v: 1, cover: null });
    raw.set('bad-media', {
      id: 'bad-media',
      v: 1,
      cover: {
        ...makeCover({ id: 'bad-media' }),
        media: [{ relId: 'x', partPath: 'y.png', bytes: 'not-bytes' }],
      },
    });
    // Future schema version — this build cannot know its shape.
    raw.set('future-version', {
      id: 'future-version',
      v: 99,
      cover: makeCover({ id: 'future-version' }),
    });
    // No version at all — never written by this module.
    raw.set('no-version', { id: 'no-version', cover: makeCover({ id: 'no-version' }) });

    const loaded = await loadCoverAssets();
    expect(loaded.map((c) => c.id)).toEqual(['good']);
  });

  it('keeps at most 20 covers, dropping the oldest (25 → 20)', async () => {
    expect(MAX_COVERS).toBe(20);
    const many = Array.from({ length: 25 }, (_, i) =>
      makeCover({ id: `c${String(i).padStart(2, '0')}`, name: `Cover ${i}`, addedAt: i + 1 }),
    );
    await saveCoverAssets(many);
    const loaded = await loadCoverAssets();
    expect(loaded).toHaveLength(MAX_COVERS);
    // The five OLDEST (addedAt 1..5) are gone; insertion order preserved.
    expect(loaded.map((c) => c.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `c${String(i + 5).padStart(2, '0')}`),
    );
  });

  it('enforceCoverCaps also caps the total media size (~50 MB), dropping the oldest', () => {
    expect(MAX_TOTAL_BYTES).toBe(50 * 1024 * 1024);
    const MB = 1024 * 1024;
    const bigCover = (id: string, addedAt: number, mb: number): CoverPageAsset =>
      makeCover({
        id,
        addedAt,
        media: [
          { relId: 'rIdBig', partPath: 'word/media/big.bin', bytes: new Uint8Array(mb * MB).fill(65) },
        ],
      });
    // 3 × 20 MB = 60 MB > 50 MB → oldest dropped → 2 × 20 MB ≤ 50 MB.
    const kept = enforceCoverCaps([bigCover('big-a', 1, 20), bigCover('big-b', 2, 20), bigCover('big-c', 3, 20)]);
    expect(kept.map((c) => c.id)).toEqual(['big-b', 'big-c']);
    // A single over-cap asset is still kept — never drop the last cover.
    expect(enforceCoverCaps([bigCover('solo', 1, 51)])).toHaveLength(1);
  });

  it('clearCoverAssets wipes the store', async () => {
    await saveCoverAssets([makeCover(), makeCover()]);
    await clearCoverAssets();
    expect(await loadCoverAssets()).toEqual([]);
  });

  it('resolves as no-ops when indexedDB is unavailable (SSR / old browsers)', async () => {
    await withoutIndexedDB(async () => {
      // WS-9b: saveCoverAssets now resolves { dropped } instead of void —
      // storage-off reports no drops (not a caps warning).
      await expect(saveCoverAssets([makeCover()])).resolves.toEqual({ dropped: [] });
      await expect(loadCoverAssets()).resolves.toEqual([]);
      await expect(clearCoverAssets()).resolves.toBeUndefined();
    });
    // Once the factory is back, storage works again (cached connection intact).
    await saveCoverAssets([makeCover({ id: 'back-again' })]);
    expect((await loadCoverAssets()).map((c) => c.id)).toEqual(['back-again']);
  });
});

/* ------------------------------------------------------------------ */
/* saveCoverAssets dropped reporting (WS-9b)                           */
/* ------------------------------------------------------------------ */

describe('saveCoverAssets dropped reporting (WS-9b)', () => {
  it('reports exactly the 5 OLDEST of 25 as dropped, in input order', async () => {
    // Input order is REVERSED (newest first) — proves the report keeps
    // INPUT order instead of re-sorting by addedAt, while still picking
    // the five oldest by addedAt (ids d00..d04, addedAt 1..5).
    const many = Array.from({ length: 25 }, (_, i) => {
      const n = 24 - i;
      return makeCover({
        id: `d${String(n).padStart(2, '0')}`,
        name: `Drop ${n}`,
        addedAt: n + 1,
      });
    });
    const { dropped } = await saveCoverAssets(many);
    expect(dropped).toHaveLength(5);
    expect(dropped.map((c) => c.id)).toEqual(['d04', 'd03', 'd02', 'd01', 'd00']);
    expect(dropped.map((c) => c.name)).toEqual([
      'Drop 4',
      'Drop 3',
      'Drop 2',
      'Drop 1',
      'Drop 0',
    ]);
    expect(dropped.map((c) => c.addedAt)).toEqual([5, 4, 3, 2, 1]);
    // Storage itself kept the newest 20 (load sorts by addedAt).
    const loaded = await loadCoverAssets();
    expect(loaded).toHaveLength(MAX_COVERS);
    expect(loaded.map((c) => c.id)).toEqual(
      Array.from({ length: MAX_COVERS }, (_, i) => `d${String(i + 5).padStart(2, '0')}`),
    );
  });

  it('reports no drops when everything fits under the caps', async () => {
    const few = Array.from({ length: MAX_COVERS }, (_, i) =>
      makeCover({ id: `fit-${i}`, name: `Fit ${i}`, addedAt: i + 1 }),
    );
    const result = await saveCoverAssets(few);
    expect(result.dropped).toEqual([]);
    expect((await loadCoverAssets()).map((c) => c.id)).toEqual(
      Array.from({ length: MAX_COVERS }, (_, i) => `fit-${i}`),
    );
  });

  it('resolves { dropped: [] } when indexedDB is unavailable', async () => {
    await withoutIndexedDB(async () => {
      await expect(saveCoverAssets([makeCover()])).resolves.toEqual({ dropped: [] });
    });
    // Factory restored — storage (and reporting) work again.
    const back = await saveCoverAssets([makeCover({ id: 'back-9b' })]);
    expect(back.dropped).toEqual([]);
    expect((await loadCoverAssets()).map((c) => c.id)).toEqual(['back-9b']);
  });

  it('a corrupt asset is sanitized away, never reported as dropped', async () => {
    const validOnes = Array.from({ length: MAX_COVERS }, (_, i) =>
      makeCover({ id: `ok-${i}`, addedAt: i + 1 }),
    );
    const corrupt = {
      ...makeCover({ id: 'corrupt', addedAt: 0 }), // oldest of all — still not "dropped"
      media: [
        { relId: 'x', partPath: 'y.png', bytes: 'not-bytes' as unknown as Uint8Array },
      ],
    };
    const { dropped } = await saveCoverAssets([...validOnes, corrupt]);
    expect(dropped).toEqual([]);
    // All 20 VALID assets stored; the corrupt one silently skipped.
    const loaded = await loadCoverAssets();
    expect(loaded).toHaveLength(MAX_COVERS);
    expect(loaded.map((c) => c.id)).toEqual(
      Array.from({ length: MAX_COVERS }, (_, i) => `ok-${i}`),
    );
  });

  it('resolves { dropped: [] } when the save transaction fails', async () => {
    // Make the FIRST put() of the save fail once (quota-style error) —
    // even though the caps WOULD drop 5 of these 25, a failed save
    // reports nothing: nothing was provably dropped.
    const origPut = FakeObjectStore.prototype.put;
    let failedOnce = false;
    const failingPut = function (this: FakeObjectStore, value: unknown) {
      if (failedOnce) return origPut.call(this, value);
      failedOnce = true;
      const req = new FakeRequest<IDBValidKey>();
      queueMicrotask(() => req.fail(new Error('QuotaExceededError: fake quota')));
      return req;
    };
    FakeObjectStore.prototype.put = failingPut;
    try {
      const many = Array.from({ length: 25 }, (_, i) =>
        makeCover({ id: `q-${i}`, addedAt: i + 1 }),
      );
      await expect(saveCoverAssets(many)).resolves.toEqual({ dropped: [] });
    } finally {
      FakeObjectStore.prototype.put = origPut;
    }
  });
});

/* ------------------------------------------------------------------ */
/* RESTORE_COVER_PAGES reducer semantics                               */
/* ------------------------------------------------------------------ */

describe('RESTORE_COVER_PAGES (reducer)', () => {
  const empty = { coverPages: [] } as unknown as AppState;

  it('fills an empty cover list', () => {
    const next = reducer(empty, { type: 'RESTORE_COVER_PAGES', covers: [coverA] });
    expect(next.coverPages).toEqual([coverA]);
    expect(next).not.toBe(empty);
  });

  it('never clobbers a non-empty list — returns the SAME state', () => {
    const next = reducer(empty, { type: 'RESTORE_COVER_PAGES', covers: [coverA] });
    const raced = reducer(next, { type: 'RESTORE_COVER_PAGES', covers: [coverB] });
    expect(raced).toBe(next);
    expect(raced.coverPages.map((c) => c.id)).toEqual(['a']);
  });

  it('ignores an empty restore payload', () => {
    expect(reducer(empty, { type: 'RESTORE_COVER_PAGES', covers: [] })).toBe(empty);
  });

  it('refills a list that removals emptied during the session', () => {
    const next = reducer(empty, { type: 'RESTORE_COVER_PAGES', covers: [coverA] });
    const emptied = reducer(next, { type: 'REMOVE_COVER_PAGE', id: coverA.id });
    expect(emptied.coverPages).toEqual([]);
    const refilled = reducer(emptied, { type: 'RESTORE_COVER_PAGES', covers: [coverB] });
    expect(refilled.coverPages.map((c) => c.id)).toEqual(['b']);
  });
});

/* ------------------------------------------------------------------ */
/* Provider wiring — mount restore + debounced save                    */
/* ------------------------------------------------------------------ */

/** Renders the cover library size + names so tests can await the restore. */
function CoverProbe() {
  const { state } = useAppState();
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'cover-count' }, String(state.coverPages.length)),
    ...state.coverPages.map((c) =>
      createElement('span', { key: c.id, 'data-testid': 'cover-name' }, c.name),
    ),
  );
}

describe('AppStateProvider restores covers on mount (WS-8a)', () => {
  it('seeds coverPages from IndexedDB after mount', async () => {
    await saveCoverAssets([
      makeCover({ id: 'restored-1', name: 'Restored cover', addedAt: 5 }),
    ]);
    render(createElement(AppStateProvider, null, createElement(CoverProbe)));
    await waitFor(() =>
      expect(screen.getByTestId('cover-count').textContent).toBe('1'),
    );
    expect(screen.getByTestId('cover-name').textContent).toBe('Restored cover');
  });

  it('stays empty when nothing is stored (no dispatch)', async () => {
    render(createElement(AppStateProvider, null, createElement(CoverProbe)));
    // The provider's own load starts before this direct one, so once ours
    // has settled, its .then has run too — deterministically.
    await expect(loadCoverAssets()).resolves.toEqual([]);
    await Promise.resolve();
    expect(screen.getByTestId('cover-count').textContent).toBe('0');
  });
});
