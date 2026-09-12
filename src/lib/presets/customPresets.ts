/**
 * Custom preset storage — persists user-created presets to localStorage.
 *
 * Built-in presets are immutable. When a user wants to modify a built-in,
 * we duplicate it into a custom preset with a new id.
 *
 * Supports v1 and v2 preset JSON. Older presets are migrated to v2 on load
 * using `migratePreset()`, which fills in defaults for new fields.
 */

import type {
  DocumentPreset,
  DocumentPresetExport,
} from './documentPreset';
import { BUILT_IN_DOCUMENT_PRESETS } from './builtInPresets';
import { migratePreset } from './presetMigration';

const STORAGE_KEY = 'codice-custom-presets-v2';

/** Generate a short unique id. */
function genId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Load all custom presets from localStorage, migrating v1 presets. */
export function loadCustomPresets(): DocumentPreset[] {
  try {
    // Try v2 storage first.
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Migrate from v1 storage key if present.
      const v1Raw = localStorage.getItem('codice-custom-presets-v1');
      if (v1Raw) {
        const v1Parsed = JSON.parse(v1Raw);
        if (Array.isArray(v1Parsed)) {
          const migrated = v1Parsed
            .map((p) => migratePreset(p))
            .map((p) => ({ ...p, builtIn: false }));
          localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
          localStorage.removeItem('codice-custom-presets-v1');
          return migrated;
        }
      }
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((p) => migratePreset(p))
      .map((p) => ({ ...p, builtIn: false }));
  } catch {
    return [];
  }
}

/** Persist all custom presets. */
function persistCustomPresets(presets: DocumentPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // ignore quota errors
  }
}

/** Get all presets (built-in + custom). */
export function getAllPresets(): DocumentPreset[] {
  return [...BUILT_IN_DOCUMENT_PRESETS, ...loadCustomPresets()];
}

/** Find a preset by id (built-in or custom). */
export function findPreset(id: string): DocumentPreset | undefined {
  const builtIn = BUILT_IN_DOCUMENT_PRESETS.find((p) => p.id === id);
  if (builtIn) return builtIn;
  return loadCustomPresets().find((p) => p.id === id);
}

/** Save a new custom preset. Returns the saved preset (with new id). */
export function saveCustomPreset(preset: DocumentPreset): DocumentPreset {
  const custom = loadCustomPresets();
  const newPreset: DocumentPreset = migratePreset({
    ...preset,
    id: genId(),
    builtIn: false,
  });
  custom.push(newPreset);
  persistCustomPresets(custom);
  return newPreset;
}

/** Update an existing custom preset by id. */
export function updateCustomPreset(preset: DocumentPreset): DocumentPreset {
  if (preset.builtIn || BUILT_IN_DOCUMENT_PRESETS.some((p) => p.id === preset.id)) {
    return saveCustomPreset(preset);
  }
  const custom = loadCustomPresets();
  const idx = custom.findIndex((p) => p.id === preset.id);
  if (idx < 0) {
    return saveCustomPreset(preset);
  }
  custom[idx] = migratePreset({ ...preset, builtIn: false });
  persistCustomPresets(custom);
  return custom[idx];
}

/** Rename a custom preset. */
export function renameCustomPreset(id: string, name: string): void {
  const custom = loadCustomPresets();
  const idx = custom.findIndex((p) => p.id === id);
  if (idx >= 0) {
    custom[idx].name = name;
    persistCustomPresets(custom);
  }
}

/** Delete a custom preset by id. */
export function deleteCustomPreset(id: string): void {
  const custom = loadCustomPresets().filter((p) => p.id !== id);
  persistCustomPresets(custom);
}

/** Duplicate any preset (built-in or custom) as a new custom preset. */
export function duplicatePreset(source: DocumentPreset, newName?: string): DocumentPreset {
  return saveCustomPreset({
    ...source,
    name: newName ?? `${source.name} (copy)`,
    builtIn: false,
  });
}

/** Export a preset as JSON (v2 format). */
export function exportPreset(preset: DocumentPreset): string {
  const exported: DocumentPresetExport = {
    version: 2,
    exportedAt: new Date().toISOString(),
    name: preset.name,
    description: preset.description,
    syntaxTheme: preset.syntaxTheme,
    page: preset.page,
    layout: preset.layout,
    pageBreaks: preset.pageBreaks,
    typography: preset.typography,
    headings: preset.headings,
    code: preset.code,
    fileHeaders: preset.fileHeaders,
    projectHeaders: preset.projectHeaders,
    projectStructure: preset.projectStructure,
    titlePage: preset.titlePage,
    colors: preset.colors,
    misc: preset.misc,
    metadata: preset.metadata,
  };
  return JSON.stringify(exported, null, 2);
}

/** Import a preset from JSON (supports v1 and v2). Returns the saved preset. */
export function importPreset(json: string, fallbackName?: string): DocumentPreset {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid preset JSON');
  }
  // migratePreset handles both v1 (no version field) and v2 (version: 2).
  const migrated = migratePreset({
    ...parsed,
    id: '',
    name: parsed.name || fallbackName || 'Imported Preset',
    builtIn: false,
  });
  return saveCustomPreset(migrated);
}
