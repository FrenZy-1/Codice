/**
 * WS-9 integration tests — image-asset persistence + storage-cap
 * warnings + export-group scaffold persistence.
 *
 * Covers:
 *   - RESTORE_IMAGE_ASSETS reducer semantics (mirror of the WS-8a
 *     RESTORE_COVER_PAGES contract: fills only an EMPTY list, never
 *     clobbers, ignores empty payloads, refills after removals)
 *   - AppStateProvider restores the image library from IndexedDB on
 *     mount (and stays empty when nothing is stored)
 *   - WS-9b: a caps-dropping save surfaces ONE warning toast (deduped
 *     per asset per session) through the optional toast hook
 *   - WS-9c: export-group SCAFFOLDS persist across reloads — names and
 *     per-export layout/first-page/cover choices survive; stale project
 *     ids are pruned at the next persist without dropping the group
 *
 * jsdom does not implement IndexedDB, so this file installs the same
 * minimal in-memory fake as coverStorage.test.ts BEFORE any production
 * call. Deterministic: request events fire as queued microtasks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { createElement, useState } from 'react';
import { saveImageAssets, loadImageAssets, MAX_IMAGES } from '@/lib/imageStorage';
import type { ImageAsset, ProjectEntry } from '@/types';
import { AppStateProvider, reducer, useAppState } from '@/hooks/useAppState';
import type { AppState } from '@/hooks/useAppState';
import { ToastProvider } from '@/components/common/Toast';

/* ------------------------------------------------------------------ */
/* Minimal fake IndexedDB (jsdom has none) — same as coverStorage      */
/* ------------------------------------------------------------------ */

function fakeEvent(type: string, target: unknown): Event {
  return { type, target } as unknown as Event;
}

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

  getAll(): FakeRequest<unknown[]> {
    const req = new FakeRequest<unknown[]>();
    queueMicrotask(() => req.succeed([...this.records.values()]));
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

  reset(): void {
    for (const { db } of this.dbs.values()) {
      for (const store of db.stores.values()) store.records.clear();
    }
  }
}

const fakeIndexedDB = new FakeIDBFactory();
(window as unknown as { indexedDB: IDBFactory }).indexedDB =
  fakeIndexedDB as unknown as IDBFactory;
(globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB =
  fakeIndexedDB as unknown as IDBFactory;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let imageSeq = 0;
function makeImage(overrides: Partial<ImageAsset> = {}): ImageAsset {
  imageSeq += 1;
  return {
    id: `img-${imageSeq}`,
    name: `Image ${imageSeq}`,
    dataUrl: `data:image/png;base64,${'A'.repeat(64)}`,
    mime: 'image/png',
    width: 10,
    height: 10,
    sizeBytes: 48,
    addedAt: imageSeq,
    ...overrides,
  };
}

const imageA = makeImage({ id: 'ia', name: 'Image A', addedAt: 1 });
const imageB = makeImage({ id: 'ib', name: 'Image B', addedAt: 2 });

/** Probe: renders image-library facts from app state. */
function ImageProbe() {
  const { state } = useAppState();
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'image-count' }, String(state.imageAssets.length)),
    ...state.imageAssets.map((a) =>
      createElement('span', { key: a.id, 'data-testid': 'image-name' }, a.name),
    ),
    createElement(
      'span',
      { 'data-testid': 'group-count' },
      String(state.exportGroups.length),
    ),
  );
}

/** Probe that can dispatch actions into the provider. */
function DispatchProbe({
  actions,
  onDispatched,
}: {
  actions: Array<Parameters<typeof reducer>[1]>;
  onDispatched?: () => void;
}) {
  const { dispatch } = useAppState();
  const [done, setDone] = useState(false);
  if (!done) {
    setDone(true);
    act(() => {
      for (const action of actions) dispatch(action);
      onDispatched?.();
    });
  }
  return null;
}

const STORAGE_KEY = 'codice-app-state-v2';

function readBlob(): Record<string, unknown> {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

beforeEach(() => {
  fakeIndexedDB.reset();
  window.localStorage.clear();
});

afterEach(cleanup);

/* ------------------------------------------------------------------ */
/* RESTORE_IMAGE_ASSETS (reducer)                                      */
/* ------------------------------------------------------------------ */

describe('RESTORE_IMAGE_ASSETS (reducer)', () => {
  // REMOVE_IMAGE_ASSET also touches fileImages — include it in the base.
  const empty = { imageAssets: [], fileImages: {} } as unknown as AppState;

  it('fills an empty image list', () => {
    const next = reducer(empty, { type: 'RESTORE_IMAGE_ASSETS', assets: [imageA] });
    expect(next.imageAssets).toEqual([imageA]);
    expect(next).not.toBe(empty);
  });

  it('never clobbers a non-empty list — returns the SAME state', () => {
    const next = reducer(empty, { type: 'RESTORE_IMAGE_ASSETS', assets: [imageA] });
    const raced = reducer(next, { type: 'RESTORE_IMAGE_ASSETS', assets: [imageB] });
    expect(raced).toBe(next);
    expect(raced.imageAssets.map((a) => a.id)).toEqual(['ia']);
  });

  it('ignores an empty restore payload', () => {
    expect(reducer(empty, { type: 'RESTORE_IMAGE_ASSETS', assets: [] })).toBe(empty);
  });

  it('refills a list that removals emptied during the session', () => {
    const next = reducer(empty, { type: 'RESTORE_IMAGE_ASSETS', assets: [imageA] });
    const emptied = reducer(next, { type: 'REMOVE_IMAGE_ASSET', id: imageA.id });
    expect(emptied.imageAssets).toEqual([]);
    const refilled = reducer(emptied, { type: 'RESTORE_IMAGE_ASSETS', assets: [imageB] });
    expect(refilled.imageAssets.map((a) => a.id)).toEqual(['ib']);
  });
});

/* ------------------------------------------------------------------ */
/* AppStateProvider restores images on mount (WS-9a)                  */
/* ------------------------------------------------------------------ */

describe('AppStateProvider restores images on mount (WS-9a)', () => {
  it('seeds imageAssets from IndexedDB after mount', async () => {
    await saveImageAssets([
      makeImage({ id: 'restored-1', name: 'Restored image', addedAt: 5 }),
    ]);
    render(createElement(AppStateProvider, null, createElement(ImageProbe)));
    await waitFor(() =>
      expect(screen.getByTestId('image-count').textContent).toBe('1'),
    );
    expect(screen.getByTestId('image-name').textContent).toBe('Restored image');
  });

  it('stays empty when nothing is stored (no dispatch)', async () => {
    render(createElement(AppStateProvider, null, createElement(ImageProbe)));
    await expect(loadImageAssets()).resolves.toEqual([]);
    await Promise.resolve();
    expect(screen.getByTestId('image-count').textContent).toBe('0');
  });
});

/* ------------------------------------------------------------------ */
/* WS-9b — caps warning toast (deduped per session)                   */
/* ------------------------------------------------------------------ */

describe('caps warning toast (WS-9b)', () => {
  it('warns once when an image save drops the oldest over the cap', async () => {
    const many = Array.from({ length: MAX_IMAGES + 5 }, (_, i) =>
      makeImage({ id: `t-${i}`, name: `Toast ${i}`, addedAt: i + 1 }),
    );
    render(
      createElement(
        ToastProvider,
        null,
        createElement(
          AppStateProvider,
          null,
          createElement(DispatchProbe, {
            actions: [{ type: 'ADD_IMAGE_ASSETS', assets: many }],
          }),
          createElement(ImageProbe),
        ),
      ),
    );
    // Debounced save (500 ms) → caps drop 5 → ONE warning toast.
    await waitFor(
      () => {
        const region = screen.getByRole('region', { name: 'Notifications' });
        expect(region.textContent).toContain('Image storage limit reached');
        expect(region.textContent).toContain('Toast 0, Toast 1, Toast 2, Toast 3, Toast 4');
      },
      { timeout: 3000 },
    );
    // The toast stays singular (deduped) even after another save tick.
    await expect(loadImageAssets()).resolves.toHaveLength(MAX_IMAGES);
    const region = screen.getByRole('region', { name: 'Notifications' });
    const titles = (region.textContent ?? '').match(/Image storage limit reached/g) ?? [];
    expect(titles).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* WS-9c — export-group scaffold persistence                          */
/* ------------------------------------------------------------------ */

describe('export-group scaffold persistence (WS-9c)', () => {
  it('restores a scaffold (name + per-export choices) from storage', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        outputMode: 'groups',
        exportGroups: [
          {
            id: 'g1',
            name: 'Thesis set',
            projectIds: [],
            layoutId: 'lay-1',
            firstPage: 'cover',
            coverId: 'cov-1',
          },
        ],
      }),
    );
    render(createElement(AppStateProvider, null, createElement(ImageProbe)));
    // The provider's lazy initializer reads the blob synchronously.
    expect(screen.getByTestId('group-count').textContent).toBe('1');
    expect(screen.getByTestId('group-count')).toBeTruthy();
  });

  it('full round-trip: live project ids persist, dead ids prune to a scaffold on reload', async () => {
    const project: ProjectEntry = {
      id: 'p1',
      label: 'Proj',
      folderName: 'proj',
      files: [],
      selectedCount: 0,
      selectedSize: 0,
      warnings: [],
      addedAt: 1,
    };
    const { unmount } = render(
      createElement(
        AppStateProvider,
        null,
        createElement(DispatchProbe, {
          actions: [
            { type: 'ADD_PROJECT', project },
            {
              type: 'ADD_EXPORT_GROUP',
              group: {
                id: 'g9',
                name: 'Dissertation',
                projectIds: ['p1'],
                layoutId: 'lay-x',
                firstPage: 'title',
              },
            },
          ],
        }),
        createElement(ImageProbe),
      ),
    );
    // Debounced persist (500 ms) writes the blob with the LIVE project id.
    await waitFor(
      () => {
        const blob = readBlob();
        const groups = blob.exportGroups as Array<Record<string, unknown>>;
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({
          id: 'g9',
          name: 'Dissertation',
          projectIds: ['p1'],
          layoutId: 'lay-x',
          firstPage: 'title',
        });
      },
      { timeout: 3000 },
    );
    // "Reload": unmount (session state dies) and mount a fresh provider —
    // projects do NOT rehydrate, so p1 is dead; the scaffold must survive.
    unmount();
    render(createElement(AppStateProvider, null, createElement(ImageProbe)));
    expect(screen.getByTestId('group-count').textContent).toBe('1');
    // Next debounced persist prunes the dead id but keeps the scaffold.
    await waitFor(
      () => {
        const blob = readBlob();
        const groups = blob.exportGroups as Array<Record<string, unknown>>;
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({
          id: 'g9',
          name: 'Dissertation',
          projectIds: [],
          layoutId: 'lay-x',
          firstPage: 'title',
        });
      },
      { timeout: 3000 },
    );
  });

  it('junk group fields are dropped on load (shape validation)', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        exportGroups: [
          { id: 'ok', name: 'OK', projectIds: [] },
          { id: 42, name: 'bad id', projectIds: [] },
          { id: 'bad-ids', name: 'Bad ids', projectIds: ['a', 7] },
          { id: 'junk-extras', name: 'Junk extras', projectIds: [], firstPage: 'weird', layoutId: 9 },
        ],
      }),
    );
    render(createElement(AppStateProvider, null, createElement(ImageProbe)));
    // 'ok' and 'junk-extras' have valid base shapes (the junk group's
    // firstPage/layoutId VALUES are dropped, but the group survives);
    // the bad-id and mixed-ids groups are rejected entirely.
    expect(screen.getByTestId('group-count').textContent).toBe('2');
    // Persist the sanitized state back and verify the junk is gone.
    await waitFor(
      () => {
        const blob = readBlob();
        const groups = blob.exportGroups as Array<Record<string, unknown>>;
        expect(groups).toHaveLength(2);
        expect(groups.find((g) => g.id === 'ok')).toMatchObject({ id: 'ok', name: 'OK' });
        const junk = groups.find((g) => g.id === 'junk-extras');
        expect(junk).toMatchObject({ id: 'junk-extras', name: 'Junk extras' });
        expect(junk?.firstPage).toBeUndefined();
        expect(junk?.layoutId).toBeUndefined();
      },
      { timeout: 3000 },
    );
  });
});
