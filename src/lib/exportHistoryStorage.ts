/**
 * R15 — IndexedDB persistence for export history.
 *
 * History entries (metadata + the generated Blob) survive reloads: a
 * re-download after a page refresh works without re-running the export
 * pipeline. Mirrors the coverStorage design deliberately:
 *
 *   - one dedicated database ('codice-history'), one store
 *   - a record schema version — unknown future records are skipped on load
 *   - defensive rehydration: every field validated, corrupt records skipped
 *   - every function degrades to a silent no-op without `indexedDB`
 *     (SSR render, old browsers, blocked storage) — history then behaves
 *     exactly as before R15 (session-scoped)
 *
 * The object URL is NOT stored (it is realm/session-specific) — it is
 * recreated on load.
 */
import { EXPORT_HISTORY_CAP, type ExportHistoryEntry } from './exportHistory';

const DB_NAME = 'codice-history';
const DB_VERSION = 1;
const STORE_NAME = 'exports';
/** Record schema version — records from an unknown future version are skipped on load. */
const SCHEMA_VERSION = 1;
/** Maximum number of stored exports (oldest dropped beyond this). */
export const MAX_HISTORY = EXPORT_HISTORY_CAP;

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
      request.onblocked = () =>
        reject(new Error(`Opening ${DB_NAME} was blocked`));
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

const FORMATS: ExportHistoryEntry['format'][] = ['docx', 'pdf', 'odt', 'zip'];

/**
 * Validate + normalize one stored record (used on BOTH save and load).
 * Returns null when the shape is corrupt — callers skip such entries.
 * `url` is assigned fresh by the caller (it is session-specific).
 */
function normalizeRecord(input: unknown): Omit<ExportHistoryEntry, 'url'> | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;
  if (r.schemaVersion !== SCHEMA_VERSION) return null;
  if (!isString(r.id) || r.id.length === 0) return null;
  if (!isString(r.filename) || r.filename.length === 0) return null;
  if (!isString(r.format) || !FORMATS.includes(r.format as ExportHistoryEntry['format']))
    return null;
  if (!isFiniteNumber(r.sizeBytes) || r.sizeBytes < 0) return null;
  if (!isFiniteNumber(r.elapsedMs) || r.elapsedMs < 0) return null;
  if (!isFiniteNumber(r.at)) return null;
  if (!(r.blob instanceof Blob)) return null;
  if (r.detail !== undefined && !isString(r.detail)) return null;
  return {
    id: r.id,
    filename: r.filename,
    format: r.format as ExportHistoryEntry['format'],
    sizeBytes: r.sizeBytes,
    elapsedMs: r.elapsedMs,
    at: r.at,
    ...(isString(r.detail) ? { detail: r.detail } : {}),
    blob: r.blob,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Persist the history list (REPLACES the store — removals and cap
 * drops propagate). Entries without a blob (defensive) are skipped.
 * Best-effort: resolves silently when IndexedDB is unavailable.
 */
export async function saveExportHistory(entries: ExportHistoryEntry[]): Promise<void> {
  const idb = idbFactory();
  if (!idb) return; // no-op (SSR / blocked storage)
  try {
    const db = await openDatabase();
    // Fresh records: strip the object URL, tag the schema version.
    const records = entries
      .filter((e) => e.blob instanceof Blob)
      .map((e) => ({
        schemaVersion: SCHEMA_VERSION,
        id: e.id,
        filename: e.filename,
        format: e.format,
        sizeBytes: e.sizeBytes,
        elapsedMs: e.elapsedMs,
        at: e.at,
        ...(e.detail !== undefined ? { detail: e.detail } : {}),
        blob: e.blob,
      }));
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const pending: Array<Promise<void>> = [requestDone(store.clear())];
      for (const record of records) {
        // put() may throw synchronously (e.g. DataCloneError) — the
        // promise executor turns that into a rejection for us.
        pending.push(requestDone(store.put(record)));
      }
      Promise.all(pending).then(() => resolve(), reject);
    });
  } catch {
    // Storage failure must never break the export flow — stay silent.
  }
}

/**
 * Load the persisted history (newest first), recreating object URLs.
 * Corrupt/unknown-schema records are skipped; the cap applies (oldest
 * dropped). Resolves to [] when IndexedDB is unavailable or empty.
 */
export async function loadExportHistory(): Promise<ExportHistoryEntry[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const all: unknown = await new Promise<unknown>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('getAll failed'));
    });
    if (!Array.isArray(all)) return [];
    const restored: ExportHistoryEntry[] = [];
    for (const raw of all) {
      const record = normalizeRecord(raw);
      if (!record) continue;
      restored.push({ ...record, url: URL.createObjectURL(record.blob) });
    }
    // Newest first (store order is insertion order; a manual clock change
    // or an older schema could interleave), then cap — oldest dropped.
    restored.sort((a, b) => b.at - a.at);
    while (restored.length > MAX_HISTORY) {
      const dropped = restored.pop();
      if (dropped) URL.revokeObjectURL(dropped.url);
    }
    return restored;
  } catch {
    return []; // no-op (SSR / blocked storage / corrupt db)
  }
}

/** Wipe the store (used by "clear history"). Best-effort no-op on failure. */
export async function clearExportHistory(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      requestDone(tx.objectStore(STORE_NAME).clear()).then(() => resolve(), reject);
    });
  } catch {
    // Silent — clearing storage must never break the UI.
  }
}
