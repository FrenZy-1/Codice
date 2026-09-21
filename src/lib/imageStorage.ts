/**
 * IndexedDB persistence for imported image assets (§10/§11, WS-9a).
 *
 * Image assets are self-contained data URLs — far too large for the
 * localStorage state blob once a library grows — so they persist in a
 * dedicated IndexedDB database instead: one database ('codice-images')
 * with a single object store ('images') keyed by the asset id.
 *
 * Everything here is BEST-EFFORT by design:
 *   - no `indexedDB` (SSR render, old browsers, blocked storage) → every
 *     function resolves as a no-op instead of throwing;
 *   - a failed open/transaction or an un-cloneable payload never rejects
 *     (persistence must never break the session);
 *   - corrupt or future-schema records are skipped on load.
 *
 * Quota safety: at most MAX_IMAGES assets are kept (the OLDEST by
 * addedAt go first) and the estimated serialized size of the stored set
 * is capped at MAX_TOTAL_BYTES (again dropping the oldest first).
 * Images are normalized/downscaled to ≤1600 px at import time, so they
 * run smaller than cover pages — 40 of them fits in ~60 MB.
 */

import type { ImageAsset } from '@/types';

/* ------------------------------------------------------------------ */
/* Constants (exported for tests)                                      */
/* ------------------------------------------------------------------ */

const DB_NAME = 'codice-images';
const DB_VERSION = 1;
const STORE_NAME = 'images';
/** Record schema version — records from an unknown future version are skipped on load. */
const SCHEMA_VERSION = 1;
/** Maximum number of stored image assets (oldest dropped beyond this). */
export const MAX_IMAGES = 40;
/** Maximum estimated serialized size of the stored set (~60 MB). */
export const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* Availability + cached connection                                    */
/* ------------------------------------------------------------------ */

/** The browser's IndexedDB factory, or null when unavailable (SSR etc.). */
function idbFactory(): IDBFactory | null {
  if (typeof window === 'undefined') return null; // SSR / non-browser
  const idb = (window as Window & { indexedDB?: IDBFactory }).indexedDB;
  return idb ?? null;
}

/** Cached connection so concurrent calls never open the DB twice. */
let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const idb = idbFactory();
      if (!idb) {
        reject(new Error('IndexedDB is unavailable'));
        return;
      }
      const request = idb.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error(`Failed to open ${DB_NAME}`));
      request.onblocked = () => reject(new Error(`Opening ${DB_NAME} was blocked`));
    });
    // A failed open must not poison the cache — let a later call retry.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/** Resolve when the request succeeds, reject on its error event. */
function requestDone(request: IDBRequest): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/* ------------------------------------------------------------------ */
/* Sanitization / rehydration                                          */
/* ------------------------------------------------------------------ */

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** PNG/JPEG only — the two formats the import pipeline normalizes to. */
function isImageMime(v: unknown): v is ImageAsset['mime'] {
  return v === 'image/png' || v === 'image/jpeg';
}

/**
 * Validate + normalize one image asset (used on BOTH save and load).
 * Returns null when the shape is corrupt — callers skip such entries.
 */
function normalizeImageAsset(input: unknown): ImageAsset | null {
  if (!input || typeof input !== 'object') return null;
  const a = input as Record<string, unknown>;
  if (!isString(a.id) || a.id.length === 0) return null;
  if (!isString(a.name)) return null;
  // Self-contained data URLs only — blob: URLs die before an export runs.
  if (!isString(a.dataUrl) || !a.dataUrl.startsWith('data:image/')) return null;
  if (!isImageMime(a.mime)) return null;
  if (!isFiniteNumber(a.width) || !Number.isInteger(a.width) || a.width < 1) {
    return null;
  }
  if (!isFiniteNumber(a.height) || !Number.isInteger(a.height) || a.height < 1) {
    return null;
  }
  if (!isFiniteNumber(a.sizeBytes)) return null;
  if (!isFiniteNumber(a.addedAt)) return null;
  // Optional caption — only a real string survives a restore.
  let caption: string | undefined;
  if (a.caption !== undefined) {
    if (!isString(a.caption)) return null;
    caption = a.caption;
  }
  return {
    id: a.id,
    name: a.name,
    dataUrl: a.dataUrl,
    mime: a.mime,
    width: a.width,
    height: a.height,
    sizeBytes: a.sizeBytes,
    addedAt: a.addedAt,
    ...(caption !== undefined ? { caption } : {}),
  };
}

/** Estimated serialized size of one asset (data URL + label strings). */
function estimateBytes(asset: ImageAsset): number {
  return asset.dataUrl.length + asset.name.length + (asset.caption?.length ?? 0);
}

/**
 * Enforce the storage caps: at most MAX_IMAGES assets and an estimated
 * total under MAX_TOTAL_BYTES — the OLDEST assets (by addedAt) are
 * dropped first. A single asset larger than the cap is still kept
 * (dropping the very last image would surprise more than help).
 *
 * Unlike the cover path, the dropped assets are RETURNED (in input
 * order) so the save caller can warn the user what fell off (WS-9b).
 */
export function enforceImageCaps(
  assets: ImageAsset[],
): { kept: ImageAsset[]; dropped: ImageAsset[] } {
  let kept = [...assets];
  if (kept.length > MAX_IMAGES) {
    // Drop the (length − MAX_IMAGES) oldest — by OBJECT identity, so
    // duplicate ids (if any ever appear) cannot take extra victims.
    const excess = kept.length - MAX_IMAGES;
    const oldestFirst = [...kept].sort((a, b) => a.addedAt - b.addedAt);
    const drop = new Set(oldestFirst.slice(0, excess));
    kept = kept.filter((a) => !drop.has(a));
  }
  let total = kept.reduce((sum, a) => sum + estimateBytes(a), 0);
  while (total > MAX_TOTAL_BYTES && kept.length > 1) {
    let oldest = kept[0];
    for (const a of kept) if (a.addedAt < oldest.addedAt) oldest = a;
    total -= estimateBytes(oldest);
    kept = kept.filter((a) => a !== oldest);
  }
  const keptSet = new Set(kept);
  const dropped = assets.filter((a) => !keptSet.has(a));
  return { kept, dropped };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Stored-record shape (keyPath 'id' → the asset id). */
interface ImageRecord {
  id: string;
  /** Record schema version — future versions are skipped on load. */
  v: number;
  image: ImageAsset;
}

/**
 * Persist the full image list (REPLACES whatever was stored, so removals
 * propagate automatically). Best-effort: resolves silently when IndexedDB
 * is unavailable, the payload cannot be cloned or the transaction fails.
 * Caps are enforced here (oldest dropped first) and the caps-dropped
 * assets are returned so the caller can warn the user (WS-9b).
 */
export async function saveImageAssets(
  assets: ImageAsset[],
): Promise<{ dropped: ImageAsset[] }> {
  if (!idbFactory()) return { dropped: [] };
  try {
    // Validate defensively: a single stray-corrupt asset must not kill
    // the save of the whole library.
    const valid = assets
      .map((a) => normalizeImageAsset(a))
      .filter((a): a is ImageAsset => a !== null);
    const { kept, dropped } = enforceImageCaps(valid);
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const pending: Array<Promise<void>> = [requestDone(store.clear())];
      for (const image of kept) {
        const record: ImageRecord = { id: image.id, v: SCHEMA_VERSION, image };
        // put() may throw synchronously (e.g. DataCloneError) — the
        // promise executor turns that into a rejection for us.
        pending.push(requestDone(store.put(record)));
      }
      Promise.all(pending).then(() => resolve(), reject);
    });
    return { dropped };
  } catch {
    // Persistence is best-effort — never surface storage failures, and
    // nothing is meaningfully "dropped" when storage is off.
    return { dropped: [] };
  }
}

/**
 * Restore the stored image list (ordered by addedAt, corrupt entries
 * skipped). Resolves to [] when IndexedDB is unavailable or the store
 * cannot be read.
 */
export async function loadImageAssets(): Promise<ImageAsset[]> {
  if (!idbFactory()) return [];
  try {
    const db = await openDatabase();
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const req = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () =>
        reject(req.error ?? new Error('Failed to read stored images'));
    });
    const images: ImageAsset[] = [];
    for (const record of records) {
      if (!record || typeof record !== 'object') continue;
      const r = record as Record<string, unknown>;
      // Version clamp: only records of a schema version this build knows
      // are considered — anything else (future format / junk) is skipped.
      if (r.v !== SCHEMA_VERSION) continue;
      const image = normalizeImageAsset(r.image);
      if (image) images.push(image);
    }
    // getAll() yields primary-key order — restore library order by addedAt.
    images.sort((a, b) => a.addedAt - b.addedAt);
    return images;
  } catch {
    return [];
  }
}

/** Wipe every stored image asset. Best-effort, never rejects. */
export async function clearImageAssets(): Promise<void> {
  if (!idbFactory()) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).clear();
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(req.error ?? new Error('Failed to clear stored images'));
    });
  } catch {
    // Persistence is best-effort — never surface storage failures.
  }
}
