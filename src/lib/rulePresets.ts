/**
 * Saved selection-rule presets.
 *
 * A preset captures a named pair of exclude/include pattern lists so the
 * user can re-apply the same selection policy to any project (or hand a
 * colleague the same "only ship src/**" filter). Presets live in
 * localStorage under a dedicated key and are capped to keep the payload
 * small.
 */

export interface RulePreset {
  id: string;
  name: string;
  /** Glob patterns that deselect matching files. */
  exclude: string[];
  /** Glob patterns that re-select files (rescue them from excludes). */
  include: string[];
  createdAt: number;
}

export const RULE_PRESETS_STORAGE_KEY = 'codice-rule-presets-v1';
export const RULE_PRESETS_CAP = 20;

/** Envelope kind written into shared JSON files. */
export const RULE_PRESETS_FILE_KIND = 'codice-rule-presets';
/** Envelope schema version. Bump when the payload shape changes. */
export const RULE_PRESETS_FILE_VERSION = 1;

export interface RulePresetFile {
  kind: typeof RULE_PRESETS_FILE_KIND;
  version: number;
  exportedAt: string;
  presets: RulePreset[];
}

/** Read all saved presets (oldest first). Corrupt entries are dropped. */
export function loadRulePresets(): RulePreset[] {
  try {
    const raw = localStorage.getItem(RULE_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const presets: RulePreset[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as RulePreset).id === 'string' &&
        typeof (item as RulePreset).name === 'string' &&
        Array.isArray((item as RulePreset).exclude) &&
        Array.isArray((item as RulePreset).include)
      ) {
        presets.push({
          id: (item as RulePreset).id,
          name: (item as RulePreset).name,
          exclude: (item as RulePreset).exclude.filter(
            (x): x is string => typeof x === 'string',
          ),
          include: (item as RulePreset).include.filter(
            (x): x is string => typeof x === 'string',
          ),
          createdAt:
            typeof (item as RulePreset).createdAt === 'number'
              ? (item as RulePreset).createdAt
              : 0,
        });
      }
    }
    return presets;
  } catch {
    return [];
  }
}

/** Persist presets; silently ignores quota errors. */
export function persistRulePresets(presets: readonly RulePreset[]): void {
  try {
    localStorage.setItem(
      RULE_PRESETS_STORAGE_KEY,
      JSON.stringify(presets.slice(0, RULE_PRESETS_CAP)),
    );
  } catch {
    // ignore quota errors
  }
}

/** Create a preset from the current pattern lists (newest first on save). */
export function createRulePreset(
  name: string,
  exclude: readonly string[],
  include: readonly string[],
  now = Date.now(),
): RulePreset {
  return {
    id: `rp-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || 'Untitled rules',
    exclude: [...exclude],
    include: [...include],
    createdAt: now,
  };
}

/** Prepend a preset, cap the list, and persist. Returns the new list. */
export function pushRulePreset(
  presets: readonly RulePreset[],
  preset: RulePreset,
  cap = RULE_PRESETS_CAP,
): RulePreset[] {
  const next = [preset, ...presets].slice(0, cap);
  persistRulePresets(next);
  return next;
}

/** Remove a preset by id and persist. Returns the new list. */
export function removeRulePreset(
  presets: readonly RulePreset[],
  id: string,
): RulePreset[] {
  const next = presets.filter((p) => p.id !== id);
  persistRulePresets(next);
  return next;
}

/**
 * Serialize presets into a portable JSON envelope for sharing.
 *
 * The envelope carries a kind + version so a colleague's import dialog can
 * reject unrelated JSON files with a helpful error instead of garbage.
 */
export function serializeRulePresets(
  presets: readonly RulePreset[],
  exportedAt = new Date().toISOString(),
): string {
  const file: RulePresetFile = {
    kind: RULE_PRESETS_FILE_KIND,
    version: RULE_PRESETS_FILE_VERSION,
    exportedAt,
    presets: presets.map((p) => ({
      id: p.id,
      name: p.name,
      exclude: [...p.exclude],
      include: [...p.include],
      createdAt: p.createdAt,
    })),
  };
  return JSON.stringify(file, null, 2);
}

export interface ParsedRulePresetFile {
  presets: RulePreset[];
  /** Number of entries dropped for missing/invalid fields. */
  invalid: number;
}

/**
 * Parse a shared JSON file back into presets.
 *
 * Throws a descriptive Error when the envelope itself is wrong (not JSON,
 * wrong kind, wrong version) so the UI can show an actionable message;
 * individual corrupt entries are skipped and counted instead.
 */
export function parseRulePresets(json: string): ParsedRulePresetFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Unexpected file structure.');
  }
  const envelope = parsed as Partial<RulePresetFile>;
  if (envelope.kind !== RULE_PRESETS_FILE_KIND) {
    throw new Error('This file is not a Codice rules export.');
  }
  if (envelope.version !== RULE_PRESETS_FILE_VERSION) {
    throw new Error(
      `Unsupported rules file version: ${String(envelope.version)}.`,
    );
  }
  if (!Array.isArray(envelope.presets)) {
    throw new Error('The file contains no preset list.');
  }

  const presets: RulePreset[] = [];
  let invalid = 0;
  for (const item of envelope.presets) {
    const preset = sanitizeRulePreset(item);
    if (preset) presets.push(preset);
    else invalid += 1;
  }
  return { presets, invalid };
}

/** Validate one unknown entry; returns null when it is not a preset. */
function sanitizeRulePreset(item: unknown): RulePreset | null {
  if (!item || typeof item !== 'object') return null;
  const p = item as Partial<RulePreset>;
  if (typeof p.name !== 'string' || p.name.trim() === '') return null;
  if (!Array.isArray(p.exclude) || !Array.isArray(p.include)) return null;
  const exclude = p.exclude.filter((x): x is string => typeof x === 'string');
  const include = p.include.filter((x): x is string => typeof x === 'string');
  if (exclude.length === 0 && include.length === 0) return null;
  return {
    id:
      typeof p.id === 'string' && p.id
        ? p.id
        : `rp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: p.name,
    exclude,
    include,
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
  };
}

export interface MergeResult {
  presets: RulePreset[];
  /** How many incoming presets were new. */
  added: number;
  /** How many incoming presets duplicated existing ones and were skipped. */
  duplicates: number;
}

/**
 * Merge imported presets into the local list.
 *
 * A preset is a duplicate when an existing one has the same name AND the
 * same pattern lists (ids are instance-local and never compared). Newest
 * first, capped like the live list.
 */
export function mergeRulePresets(
  existing: readonly RulePreset[],
  incoming: readonly RulePreset[],
  cap = RULE_PRESETS_CAP,
): MergeResult {
  const same =
    (a: readonly string[], b: readonly string[]) =>
      a.length === b.length && a.every((x, i) => x === b[i]);
  const isDuplicate = (candidate: RulePreset) =>
    existing.some(
      (p) =>
        p.name === candidate.name &&
        same(p.exclude, candidate.exclude) &&
        same(p.include, candidate.include),
    );

  const fresh: RulePreset[] = [];
  let duplicates = 0;
  for (const preset of incoming) {
    if (isDuplicate(preset) || fresh.some((p) => p.name === preset.name && same(p.exclude, preset.exclude) && same(p.include, preset.include))) {
      duplicates += 1;
    } else {
      fresh.push(preset);
    }
  }
  const merged = [...fresh, ...existing].slice(0, cap);
  persistRulePresets(merged);
  return { presets: merged, added: fresh.length, duplicates };
}

/** True when a preset's pattern lists exactly match the given ones. */
export function rulePresetMatches(
  preset: RulePreset,
  exclude: readonly string[],
  include: readonly string[],
): boolean {
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((x, i) => x === b[i]);
  return same(preset.exclude, exclude) && same(preset.include, include);
}
