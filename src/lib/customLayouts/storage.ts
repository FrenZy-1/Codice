/**
 * Custom layout template persistence v2 (§30).
 *
 * Templates are stored locally in localStorage as a versioned JSON list —
 * no account/database required. CRUD + import/export live here so the React
 * state layer only mirrors this module's truth.
 *
 * v1 templates (flat blocks + repeat) are MIGRATED into the v2
 * File → Section → Block → Field hierarchy on load and on import (§9 —
 * the old Block Editor's work is kept, re-homed in the new semantics).
 */

import type { CustomLayoutTemplate, CustomLayoutTemplateV1 } from './model';
import { cloneTemplate, ensureTemplateV2, genLayoutId, normalizeTemplate } from './model';

const STORAGE_KEY = 'codice-custom-layouts-v1';

function safeParseList(raw: string | null): CustomLayoutTemplate[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CustomLayoutTemplate[] = [];
    for (const t of parsed) {
      if (!t || typeof t.id !== 'string' || typeof t.name !== 'string') continue;
      // v2 shape: sections array. v1 shape: blocks + fields arrays.
      if (Array.isArray(t.sections)) {
        out.push(ensureTemplateV2(t as CustomLayoutTemplate));
      } else if (Array.isArray(t.blocks) && Array.isArray(t.fields)) {
        out.push(ensureTemplateV2(t as CustomLayoutTemplateV1));
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Load every stored template (migrating any legacy v1 entries). Each load
 * runs `normalizeTemplate` so templates saved by older builds pick up the
 * §5/§6 field-content sync and the §7 file-level children array — the
 * exporter, preview and studio all observe the same normalized shape.
 */
export function loadCustomLayouts(): CustomLayoutTemplate[] {
  if (typeof window === 'undefined') return [];
  try {
    return safeParseList(window.localStorage.getItem(STORAGE_KEY)).map(normalizeTemplate);
  } catch {
    return [];
  }
}

function persist(templates: CustomLayoutTemplate[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch {
    // quota — templates stay in memory for this session
  }
}

/** Add a template; returns the stored list. */
export function storeCustomLayout(template: CustomLayoutTemplate): CustomLayoutTemplate[] {
  const list = loadCustomLayouts();
  list.push(cloneTemplate(template));
  persist(list);
  return list;
}

/** Replace a template (by id); returns the stored list. */
export function updateCustomLayout(template: CustomLayoutTemplate): CustomLayoutTemplate[] {
  const list = loadCustomLayouts();
  const idx = list.findIndex((t) => t.id === template.id);
  const updated = { ...cloneTemplate(template), updatedAt: Date.now() };
  if (idx >= 0) list[idx] = updated;
  else list.push(updated);
  persist(list);
  return list;
}

/** Delete a template by id; returns the stored list. */
export function deleteCustomLayout(id: string): CustomLayoutTemplate[] {
  const list = loadCustomLayouts().filter((t) => t.id !== id);
  persist(list);
  return list;
}

/** Rename a template; returns the stored list. */
export function renameCustomLayout(id: string, name: string): CustomLayoutTemplate[] {
  const list = loadCustomLayouts();
  for (const t of list) {
    if (t.id === id) {
      t.name = name;
      t.updatedAt = Date.now();
    }
  }
  persist(list);
  return list;
}

/** Duplicate a template under a new name; returns the stored list + the copy. */
export function duplicateCustomLayout(
  template: CustomLayoutTemplate,
  newName?: string,
): { templates: CustomLayoutTemplate[]; copy: CustomLayoutTemplate } {
  const copy = cloneTemplate(template);
  copy.id = genLayoutId('clt');
  copy.name = newName ?? `${template.name} copy`;
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  const list = loadCustomLayouts();
  list.push(copy);
  persist(list);
  return { templates: list, copy: cloneTemplate(copy) };
}

/** Find a template by id (built-ins don't exist for layouts). */
export function findCustomLayout(id: string): CustomLayoutTemplate | undefined {
  return loadCustomLayouts().find((t) => t.id === id);
}

/* ------------------------------------------------------------------ */
/* Import / export (versioned JSON, §30)                               */
/* ------------------------------------------------------------------ */

export interface CustomLayoutExport {
  kind: 'codice-custom-layout';
  version: 2;
  exportedAt: string;
  template: CustomLayoutTemplate;
}

/** Serialize a template to a portable JSON string. */
export function exportLayoutJson(template: CustomLayoutTemplate): string {
  const payload: CustomLayoutExport = {
    kind: 'codice-custom-layout',
    version: 2,
    exportedAt: new Date().toISOString(),
    template: cloneTemplate(template),
  };
  return JSON.stringify(payload, null, 2);
}

/** Parse + validate + migrate an imported template JSON string. */
export function importLayoutJson(
  json: string,
  fallbackName?: string,
): CustomLayoutTemplate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  const payload = parsed as Partial<CustomLayoutExport> & Partial<CustomLayoutTemplateV1> & Partial<CustomLayoutTemplate>;
  const template = (payload.template ?? parsed) as Partial<CustomLayoutTemplate> &
    Partial<CustomLayoutTemplateV1>;
  const hasV2 = Array.isArray(template.sections);
  const hasV1 =
    Array.isArray((template as Partial<CustomLayoutTemplateV1>).blocks) &&
    Array.isArray((template as Partial<CustomLayoutTemplateV1>).fields);
  if (!template || (!hasV2 && !hasV1)) {
    throw new Error('This JSON is not a Codice custom layout template.');
  }
  const migrated = ensureTemplateV2(template as CustomLayoutTemplate | CustomLayoutTemplateV1);
  const imported: CustomLayoutTemplate = {
    ...migrated,
    id: genLayoutId('clt'),
    name:
      typeof template.name === 'string' && template.name.trim()
        ? template.name
        : fallbackName ?? 'Imported layout',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const list = loadCustomLayouts();
  list.push(imported);
  persist(list);
  return imported;
}
