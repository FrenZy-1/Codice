/**
 * Custom preset storage — persists user-created presets to localStorage.
 *
 * Built-in presets are immutable. When a user wants to modify a built-in,
 * we duplicate it into a custom preset with a new id.
 */

import type {
  DocumentPreset,
  DocumentPresetExport,
} from './documentPreset';
import { BUILT_IN_DOCUMENT_PRESETS } from './builtInPresets';

const STORAGE_KEY = 'codice-custom-presets-v1';

/** Generate a short unique id. */
function genId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Load all custom presets from localStorage. */
export function loadCustomPresets(): DocumentPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is DocumentPreset => p && typeof p === 'object' && p.id && p.name)
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
  const newPreset: DocumentPreset = {
    ...preset,
    id: genId(),
    builtIn: false,
  };
  custom.push(newPreset);
  persistCustomPresets(custom);
  return newPreset;
}

/** Update an existing custom preset by id. Throws if id is unknown or built-in. */
export function updateCustomPreset(preset: DocumentPreset): DocumentPreset {
  if (preset.builtIn || BUILT_IN_DOCUMENT_PRESETS.some((p) => p.id === preset.id)) {
    // Built-ins are immutable — duplicate as new custom preset.
    return saveCustomPreset(preset);
  }
  const custom = loadCustomPresets();
  const idx = custom.findIndex((p) => p.id === preset.id);
  if (idx < 0) {
    return saveCustomPreset(preset);
  }
  custom[idx] = { ...preset, builtIn: false };
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

/** Export a preset as a JSON-serializable object. */
export function exportPreset(preset: DocumentPreset): string {
  const exported: DocumentPresetExport = {
    name: preset.name,
    description: preset.description,
    syntaxTheme: preset.syntaxTheme,
    page: preset.page,
    typography: preset.typography,
    headings: preset.headings,
    code: preset.code,
    fileHeaders: preset.fileHeaders,
    projectHeaders: preset.projectHeaders,
    titlePage: preset.titlePage,
    colors: preset.colors,
    metadata: preset.metadata,
    includeToc: preset.includeToc,
    includeProjectStructure: preset.includeProjectStructure,
    pageBreakBetweenFiles: preset.pageBreakBetweenFiles,
    version: 1,
    exportedAt: new Date().toISOString(),
  };
  return JSON.stringify(exported, null, 2);
}

/** Import a preset from JSON. Returns the saved preset. */
export function importPreset(json: string, fallbackName?: string): DocumentPreset {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid preset JSON');
  }
  const preset: DocumentPreset = {
    id: '',
    name: parsed.name || fallbackName || 'Imported Preset',
    description: parsed.description || '',
    builtIn: false,
    syntaxTheme: parsed.syntaxTheme || 'github-light',
    page: parsed.page,
    typography: parsed.typography,
    headings: parsed.headings,
    code: parsed.code,
    fileHeaders: parsed.fileHeaders,
    projectHeaders: parsed.projectHeaders,
    titlePage: parsed.titlePage,
    colors: parsed.colors,
    metadata: parsed.metadata,
    includeToc: parsed.includeToc ?? true,
    includeProjectStructure: parsed.includeProjectStructure ?? true,
    pageBreakBetweenFiles: parsed.pageBreakBetweenFiles ?? true,
  };
  return saveCustomPreset(preset);
}
