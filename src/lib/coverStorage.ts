/**
 * IndexedDB persistence for imported cover-page assets (§42, WS-8a).
 *
 * Cover assets carry binary media (Uint8Array) plus raw OOXML strings —
 * far too large for the localStorage state blob — so they persist in a
 * dedicated IndexedDB database instead: one database ('codice-covers')
 * with a single object store ('covers') keyed by the asset id.
 *
 * Everything here is BEST-EFFORT by design:
 *   - no `indexedDB` (SSR render, old browsers, blocked storage) → every
 *     function resolves as a no-op instead of throwing;
 *   - a failed open/transaction or an un-cloneable payload never rejects
 *     (persistence must never break the session);
 *   - corrupt or future-schema records are skipped on load.
 *
 * Quota safety: at most MAX_COVERS assets are kept (the OLDEST by
 * addedAt go first) and the estimated serialized size of the stored set
 * is capped at MAX_TOTAL_BYTES (again dropping the oldest first). Covers
 * are one-page assets, so 20 of them is generous. The save path REPORTS
 * the caps-dropped assets (saveCoverAssets resolves { dropped }) so the
 * UI can warn the user instead of silently losing the oldest covers.
 */

import type { CoverPageAsset } from '@/types';

/* ------------------------------------------------------------------ */
/* Constants (exported for tests)                                      */
/* ------------------------------------------------------------------ */

const DB_NAME = 'codice-covers';
const DB_VERSION = 1;
const STORE_NAME = 'covers';
/** Record schema version — records from an unknown future version are skipped on load. */
const SCHEMA_VERSION = 1;
/** Maximum number of stored cover assets (oldest dropped beyond this). */
export const MAX_COVERS = 20;
/** Maximum estimated serialized size of the stored set (~50 MB). */
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

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

function stringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.every(isString) ? v : null;
}

/**
 * Coerce stored media bytes back to a Uint8Array. Structured clone
 * normally returns Uint8Array as stored; plain number arrays and
 * ArrayBuffers are accepted defensively (older/odd storage forms).
 */
function toBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (
    Array.isArray(v) &&
    v.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255)
  ) {
    return Uint8Array.from(v);
  }
  return null;
}

/**
 * Validate + normalize one cover asset (used on BOTH save and load).
 * Returns null when the shape is corrupt — callers skip such entries.
 */
function normalizeCoverAsset(input: unknown): CoverPageAsset | null {
  if (!input || typeof input !== 'object') return null;
  const c = input as Record<string, unknown>;
  if (!isString(c.id) || c.id.length === 0) return null;
  if (!isString(c.name)) return null;
  if (!isString(c.fileName)) return null;
  if (!isFiniteNumber(c.addedAt)) return null;
  if (typeof c.truncated !== 'boolean') return null;
  if (!isString(c.bodyXml)) return null;
  if (!isString(c.stylesInner)) return null;
  if (!isString(c.numberingInner)) return null;
  if (!isFiniteNumber(c.pageCount)) return null;
  const styleIds = stringArray(c.styleIds);
  const numberingIds = stringArray(c.numberingIds);
  if (!styleIds || !numberingIds) return null;
  // Media: every entry must be a well-formed {relId, partPath, bytes}.
  if (!Array.isArray(c.media)) return null;
  const media: CoverPageAsset['media'] = [];
  for (const m of c.media) {
    if (!m || typeof m !== 'object') return null;
    const entry = m as Record<string, unknown>;
    if (!isString(entry.relId) || !isString(entry.partPath)) return null;
    const bytes = toBytes(entry.bytes);
    if (!bytes) return null;
    media.push({ relId: entry.relId, partPath: entry.partPath, bytes });
  }
  // Relationships: every entry must be {id, target, type}.
  if (!Array.isArray(c.rels)) return null;
  const rels: CoverPageAsset['rels'] = [];
  for (const r of c.rels) {
    if (!r || typeof r !== 'object') return null;
    const entry = r as Record<string, unknown>;
    if (!isString(entry.id) || !isString(entry.target) || !isString(entry.type)) {
      return null;
    }
    rels.push({ id: entry.id, target: entry.target, type: entry.type });
  }
  // Optional namespace declarations (added by a later import pipeline).
  let namespaces: CoverPageAsset['namespaces'] | undefined;
  if (c.namespaces !== undefined) {
    if (!Array.isArray(c.namespaces)) return null;
    namespaces = [];
    for (const n of c.namespaces) {
      if (!n || typeof n !== 'object') return null;
      const entry = n as Record<string, unknown>;
      if (!isString(entry.prefix) || !isString(entry.uri)) return null;
      namespaces.push({ prefix: entry.prefix, uri: entry.uri });
    }
  }
  // Optional page geometry — only finite numbers survive a restore.
  const geometry: Partial<
    Pick<
      CoverPageAsset,
      | 'pageWidthMm'
      | 'pageHeightMm'
      | 'marginTopMm'
      | 'marginRightMm'
      | 'marginBottomMm'
      | 'marginLeftMm'
    >
  > = {};
  if (isFiniteNumber(c.pageWidthMm)) geometry.pageWidthMm = c.pageWidthMm;
  if (isFiniteNumber(c.pageHeightMm)) geometry.pageHeightMm = c.pageHeightMm;
  if (isFiniteNumber(c.marginTopMm)) geometry.marginTopMm = c.marginTopMm;
  if (isFiniteNumber(c.marginRightMm)) geometry.marginRightMm = c.marginRightMm;
  if (isFiniteNumber(c.marginBottomMm)) geometry.marginBottomMm = c.marginBottomMm;
  if (isFiniteNumber(c.marginLeftMm)) geometry.marginLeftMm = c.marginLeftMm;
  return {
    id: c.id,
    name: c.name,
    fileName: c.fileName,
    addedAt: c.addedAt,
    truncated: c.truncated,
    bodyXml: c.bodyXml,
    media,
    rels,
    styleIds,
    numberingIds,
    stylesInner: c.stylesInner,
    numberingInner: c.numberingInner,
    pageCount: c.pageCount,
    ...(namespaces ? { namespaces } : {}),
    ...geometry,
  };
}

/** Estimated serialized size of one asset (media bytes + string payloads). */
function estimateBytes(cover: CoverPageAsset): number {
  let total = 0;
  for (const m of cover.media) total += m.bytes.byteLength;
  total += cover.bodyXml.length + cover.stylesInner.length + cover.numberingInner.length;
  return total;
}

/**
 * Enforce the storage caps: at most MAX_COVERS assets and an estimated
 * total under MAX_TOTAL_BYTES — the OLDEST assets (by addedAt) are
 * dropped first. A single asset larger than the cap is still kept
 * (dropping the very last cover would surprise more than help).
 */
export function enforceCoverCaps(assets: CoverPageAsset[]): CoverPageAsset[] {
  let kept = [...assets];
  if (kept.length > MAX_COVERS) {
    // Drop the (length − MAX_COVERS) oldest — by OBJECT identity, so
    // duplicate ids (if any ever appear) cannot take extra victims.
    const excess = kept.length - MAX_COVERS;
    const oldestFirst = [...kept].sort((a, b) => a.addedAt - b.addedAt);
    const drop = new Set(oldestFirst.slice(0, excess));
    kept = kept.filter((c) => !drop.has(c));
  }
  let total = kept.reduce((sum, c) => sum + estimateBytes(c), 0);
  while (total > MAX_TOTAL_BYTES && kept.length > 1) {
    let oldest = kept[0];
    for (const c of kept) if (c.addedAt < oldest.addedAt) oldest = c;
    total -= estimateBytes(oldest);
    kept = kept.filter((c) => c !== oldest);
  }
  return kept;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Stored-record shape (keyPath 'id' → the asset id). */
interface CoverRecord {
  id: string;
  /** Record schema version — future versions are skipped on load. */
  v: number;
  cover: CoverPageAsset;
}

/**
 * Persist the full cover-page list (REPLACES whatever was stored, so
 * removals propagate automatically). Best-effort: resolves silently
 * when IndexedDB is unavailable, the payload cannot be cloned or the
 * transaction fails. Caps are enforced here (oldest dropped first).
 *
 * Returns the caps-dropped assets (WS-9b) so callers can warn the user:
 * empty when nothing was dropped, when storage was unavailable, or when
 * the save itself failed — storage-off is not a caps warning. Corrupt
 * entries sanitized away by validation are never reported as dropped;
 * they were never valid to begin with.
 */
export async function saveCoverAssets(
  assets: CoverPageAsset[],
): Promise<{ dropped: CoverPageAsset[] }> {
  if (!idbFactory()) return { dropped: [] };
  try {
    // Validate defensively: a single stray-corrupt asset must not kill
    // the save of the whole library.
    const valid = assets
      .map((a) => normalizeCoverAsset(a))
      .filter((a): a is CoverPageAsset => a !== null);
    const kept = enforceCoverCaps(valid);
    // Caps REPORT (WS-9b): which valid assets the caps dropped — matched
    // by OBJECT identity (exactly how enforceCoverCaps drops) and kept
    // in `valid` (input) order. Sanitized-away corrupt entries are
    // excluded: they were never valid, not "dropped".
    const keptSet = new Set(kept);
    const dropped = valid.filter((c) => !keptSet.has(c));
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const pending: Array<Promise<void>> = [requestDone(store.clear())];
      for (const cover of kept) {
        const record: CoverRecord = { id: cover.id, v: SCHEMA_VERSION, cover };
        // put() may throw synchronously (e.g. DataCloneError) — the
        // promise executor turns that into a rejection for us.
        pending.push(requestDone(store.put(record)));
      }
      Promise.all(pending).then(() => resolve(), reject);
    });
    return { dropped };
  } catch {
    // Persistence is best-effort — never surface storage failures (and
    // a failed save reports no drops: nothing was provably dropped).
    return { dropped: [] };
  }
}

/**
 * Restore the stored cover-page list (ordered by addedAt, corrupt
 * entries skipped). Resolves to [] when IndexedDB is unavailable or
 * the store cannot be read.
 */
export async function loadCoverAssets(): Promise<CoverPageAsset[]> {
  if (!idbFactory()) return [];
  try {
    const db = await openDatabase();
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const req = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () =>
        reject(req.error ?? new Error('Failed to read stored cover pages'));
    });
    const covers: CoverPageAsset[] = [];
    for (const record of records) {
      if (!record || typeof record !== 'object') continue;
      const r = record as Record<string, unknown>;
      // Version clamp: only records of a schema version this build knows
      // are considered — anything else (future format / junk) is skipped.
      if (r.v !== SCHEMA_VERSION) continue;
      const cover = normalizeCoverAsset(r.cover);
      if (cover) covers.push(cover);
    }
    // getAll() yields primary-key order — restore library order by addedAt.
    covers.sort((a, b) => a.addedAt - b.addedAt);
    return covers;
  } catch {
    return [];
  }
}

/** Wipe every stored cover asset. Best-effort, never rejects. */
export async function clearCoverAssets(): Promise<void> {
  if (!idbFactory()) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).clear();
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(req.error ?? new Error('Failed to clear stored cover pages'));
    });
  } catch {
    // Persistence is best-effort — never surface storage failures.
  }
}
