/**
 * WS-9a — image-asset persistence (IndexedDB) tests.
 *
 * Covers:
 *   - round-trip save/load with full-asset fidelity (caption + mime
 *     preserved, order by addedAt)
 *   - save REPLACES the stored list → removals propagate
 *   - corrupt records and future-schema records are skipped on load
 *   - a stray-corrupt asset in the SAVE payload cannot kill the save
 *   - caps: at most 40 images (oldest dropped first, `.dropped` in
 *     input order) and a ~60 MB estimated total-size cap
 *     (enforceImageCaps, oldest dropped first)
 *   - clearImageAssets wipes the store
 *   - missing `indexedDB` → every function resolves as a no-op
 *
 * jsdom does not implement IndexedDB, so this file installs a minimal
 * in-memory fake on globalThis/window BEFORE any production call (the
 * same harness as coverStorage.test.ts). The fake is deterministic:
 * mutations apply in call order, request events fire as microtasks (so
 * handlers attached right after a call still observe them), and `open()`
 * runs its upgrade/success events in a queued microtask. No fake timers
 * needed — plain `await` flushes everything. Images carry no binary
 * media — only data-URL strings — so the cross-realm Uint8Array trap
 * documented in coverStorage.test.ts cannot bite here; a plain deep
 * clone is enough.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveImageAssets,
  loadImageAssets,
  clearImageAssets,
  enforceImageCaps,
  MAX_IMAGES,
  MAX_TOTAL_BYTES,
} from '@/lib/imageStorage';
import type { ImageAsset } from '@/types';

/* ------------------------------------------------------------------ */
/* Minimal fake IndexedDB (jsdom has none)                             */
/* ------------------------------------------------------------------ */

function fakeEvent(type: string, target: unknown): Event {
  return { type, target } as unknown as Event;
}

/** Deep-clone records on put, like the real engine. Image records are
 * plain objects with string/number fields (no typed arrays), so no
 * cross-realm surprises are possible — unlike covers. */
function cloneValue(v: unknown): unknown {
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

let imageSeq = 0;

function makeImage(overrides: Partial<ImageAsset> = {}): ImageAsset {
  imageSeq += 1;
  return {
    id: `img-${imageSeq}`,
    name: `Image ${imageSeq}.png`,
    dataUrl: `data:image/png;base64,iVBORw0KGgoAAAANS${imageSeq}==`,
    mime: 'image/png',
    width: 640,
    height: 480,
    sizeBytes: 2048,
    addedAt: imageSeq,
    ...overrides,
  };
}

beforeEach(() => {
  fakeIndexedDB.reset();
});

/* ------------------------------------------------------------------ */
/* Storage round-trip + guards                                         */
/* ------------------------------------------------------------------ */

describe('imageStorage (WS-9a)', () => {
  it('round-trips image assets with full fidelity (caption + mime preserved)', async () => {
    const a = makeImage({ id: 'rt-a', addedAt: 10 });
    const b = makeImage({
      id: 'rt-b',
      addedAt: 20,
      mime: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==',
      width: 1600,
      height: 1200,
      sizeBytes: 4096,
      caption: 'Architecture diagram',
    });
    const c = makeImage({ id: 'rt-c', addedAt: 5, caption: '' });
    // Deliberately NOT in addedAt order — load must sort by addedAt.
    await saveImageAssets([b, a, c]);

    const loaded = await loadImageAssets();
    // Library order is by addedAt, regardless of getAll()'s key order.
    expect(loaded.map((i) => i.id)).toEqual(['rt-c', 'rt-a', 'rt-b']);
    // Whole-asset fidelity (data URL, dimensions, caption…).
    expect(loaded[0]).toEqual(c);
    expect(loaded[1]).toEqual(a);
    expect(loaded[2]).toEqual(b);
    // The two fields the spec calls out explicitly.
    expect(loaded[2].caption).toBe('Architecture diagram');
    expect(loaded[2].mime).toBe('image/jpeg');
    // An EMPTY caption survives too (it is a valid string).
    expect(loaded[0].caption).toBe('');
  });

  it('save REPLACES the stored list — removals propagate', async () => {
    const keep = makeImage({ id: 'keep-a', addedAt: 1 });
    const drop = makeImage({ id: 'drop-b', addedAt: 2 });
    await saveImageAssets([keep, drop]);
    const res = await saveImageAssets([keep]); // REMOVE_IMAGE + save effect
    expect(res.dropped).toEqual([]);
    const loaded = await loadImageAssets();
    expect(loaded.map((i) => i.id)).toEqual(['keep-a']);
  });

  it('skips corrupt and future-schema records but keeps valid ones', async () => {
    await saveImageAssets([makeImage({ id: 'good', addedAt: 1 })]);
    const raw = fakeIndexedDB.rawRecords('codice-images', 'images');
    const base = makeImage({ id: 'bad', addedAt: 2 });
    raw.set('bad-string', 'not-an-object');
    raw.set('bad-missing-id', { id: 'bad-missing-id', v: 1, image: { ...base, id: '' } });
    raw.set('bad-mime', {
      id: 'bad-mime',
      v: 1,
      image: { ...base, mime: 'image/webp' },
    });
    raw.set('bad-width', {
      id: 'bad-width',
      v: 1,
      image: { ...base, width: Number.POSITIVE_INFINITY },
    });
    raw.set('bad-caption', {
      id: 'bad-caption',
      v: 1,
      image: { ...base, caption: 42 },
    });
    raw.set('bad-dataurl', {
      id: 'bad-dataurl',
      v: 1,
      image: { ...base, dataUrl: 'https://example.com/pic.png' },
    });
    raw.set('null-image', { id: 'null-image', v: 1, image: null });
    // Future schema version — this build cannot know its shape.
    raw.set('future-version', {
      id: 'future-version',
      v: 2,
      image: base,
    });
    // No version at all — never written by this module.
    raw.set('no-version', { id: 'no-version', image: base });

    const loaded = await loadImageAssets();
    expect(loaded.map((i) => i.id)).toEqual(['good']);
  });

  it('save skips a stray-corrupt asset without killing the whole save', async () => {
    const good = makeImage({ id: 'sv-good', addedAt: 1 });
    // A webp mime can only come from a corrupted state — never the import
    // pipeline — but it must not take the good assets down with it.
    const stray = {
      ...makeImage({ id: 'sv-bad', addedAt: 2 }),
      mime: 'image/webp',
    } as unknown as ImageAsset;
    const res = await saveImageAssets([good, stray]);
    const loaded = await loadImageAssets();
    expect(loaded.map((i) => i.id)).toEqual(['sv-good']);
    // Only caps-dropped assets are reported — strays vanish silently.
    expect(res.dropped).toEqual([]);
  });

  it('keeps at most 40 images, dropping the oldest (45 → 40)', async () => {
    expect(MAX_IMAGES).toBe(40);
    const many = Array.from({ length: 45 }, (_, i) =>
      makeImage({ id: `i${String(i).padStart(2, '0')}`, name: `Image ${i}`, addedAt: i + 1 }),
    );
    // Input order deliberately ≠ addedAt order among the doomed five
    // (i04 first, i01..i03 last) — `.dropped` must preserve INPUT order.
    const input = [many[4], many[0], ...many.slice(5), many[1], many[2], many[3]];
    const { dropped } = await saveImageAssets(input);

    expect(dropped).toHaveLength(5);
    expect(dropped.map((i) => i.id)).toEqual(['i04', 'i00', 'i01', 'i02', 'i03']);
    const loaded = await loadImageAssets();
    expect(loaded).toHaveLength(MAX_IMAGES);
    // The five OLDEST (addedAt 1..5) are gone; library order by addedAt.
    expect(loaded.map((i) => i.id)).toEqual(
      Array.from({ length: 40 }, (_, i) => `i${String(i + 5).padStart(2, '0')}`),
    );
  });

  it('enforceImageCaps also caps the total size (~60 MB), dropping the oldest', () => {
    expect(MAX_TOTAL_BYTES).toBe(60 * 1024 * 1024);
    const MB = 1024 * 1024;
    const bigImage = (id: string, addedAt: number, mb: number): ImageAsset =>
      makeImage({ id, addedAt, dataUrl: `data:image/png;base64,${'A'.repeat(mb * MB)}` });
    // 3 × 25 MB = 75 MB > 60 MB → oldest dropped → 2 × 25 MB ≤ 60 MB.
    const trio = [bigImage('big-a', 1, 25), bigImage('big-b', 2, 25), bigImage('big-c', 3, 25)];
    const { kept, dropped } = enforceImageCaps(trio);
    expect(kept.map((i) => i.id)).toEqual(['big-b', 'big-c']);
    expect(dropped.map((i) => i.id)).toEqual(['big-a']);
    // Pure function — the SAME object references come back, not copies.
    expect(dropped[0]).toBe(trio[0]);
    expect(kept[0]).toBe(trio[1]);
    expect(kept[1]).toBe(trio[2]);
    // A single over-cap asset is still kept — never drop the last image.
    const solo = enforceImageCaps([bigImage('solo', 1, 61)]);
    expect(solo.kept).toHaveLength(1);
    expect(solo.dropped).toEqual([]);
  });

  it('clearImageAssets wipes the store', async () => {
    await saveImageAssets([makeImage(), makeImage()]);
    await clearImageAssets();
    expect(await loadImageAssets()).toEqual([]);
  });

  it('resolves as no-ops when indexedDB is unavailable (SSR / old browsers)', async () => {
    await withoutIndexedDB(async () => {
      await expect(saveImageAssets([makeImage()])).resolves.toEqual({ dropped: [] });
      await expect(loadImageAssets()).resolves.toEqual([]);
      await expect(clearImageAssets()).resolves.toBeUndefined();
    });
    // Once the factory is back, storage works again (cached connection intact).
    await saveImageAssets([makeImage({ id: 'back-again' })]);
    expect((await loadImageAssets()).map((i) => i.id)).toEqual(['back-again']);
  });

  it('saveImageAssets reports the caps-dropped assets (45 → 5)', async () => {
    const many = Array.from({ length: 45 }, (_, i) =>
      makeImage({ id: `d${String(i).padStart(2, '0')}`, addedAt: i + 1 }),
    );
    const { dropped } = await saveImageAssets(many);
    expect(dropped).toHaveLength(5);
    // The oldest five by addedAt, in input order (input IS addedAt order).
    expect(dropped.map((i) => i.id)).toEqual(['d00', 'd01', 'd02', 'd03', 'd04']);
    // Dropped entries carry full asset data — value-equal to the inputs
    // (saveImageAssets validates defensively, so references are copies).
    expect(dropped[0]).toEqual(many[0]);
    expect(dropped[4]).toEqual(many[4]);
    // Well under the caps → nothing dropped.
    const ok = await saveImageAssets([
      makeImage({ id: 'kept-1' }),
      makeImage({ id: 'kept-2' }),
    ]);
    expect(ok.dropped).toEqual([]);
  });
});
