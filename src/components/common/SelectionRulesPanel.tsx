'use client';

/**
 * Selection rules — per-project glob patterns.
 *
 * Two complementary rule lists:
 *   - EXCLUDE rules deselect matching files by default (red accent).
 *   - INCLUDE rules rescue matching files from exclusion rules (green accent).
 *
 * Rules are additive and non-destructive: they never delete anything, they
 * just change the default selection. A manual checkbox always wins over
 * both rule lists. Named rule sets can be saved and re-applied to any
 * project (see ./lib/rulePresets).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/components/common/Toast';
import type { ProjectEntry } from '@/types';
import {
  countRuleDeselected,
  countRuleMatches,
  countRuleSelectedTotal,
  countRescuedByIncludes,
  parseRuleInput,
  RULE_SUGGESTIONS,
  INCLUDE_RULE_SUGGESTIONS,
} from '@/lib/selectionRules';
import {
  createRulePreset,
  loadRulePresets,
  mergeRulePresets,
  parseRulePresets,
  persistRulePresets,
  pushRulePreset,
  removeRulePreset,
  rulePresetMatches,
  serializeRulePresets,
  type RulePreset,
} from '@/lib/rulePresets';
import {
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  X,
  Ban,
  Check,
  Bookmark,
  Save,
  Import,
  Download,
} from '@/components/common/Icons';

type RuleMode = 'exclude' | 'include';

interface Props {
  project: ProjectEntry;
}

export function SelectionRulesPanel({ project }: Props) {
  const { state, dispatch, getSelectedFiles } = useAppState();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<RuleMode>('exclude');
  const [draft, setDraft] = useState('');
  const [presets, setPresets] = useState<RulePreset[]>(() => loadRulePresets());
  const [presetName, setPresetName] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  // Mirror of `presets` for async handlers (avoids side effects in updaters,
  // which React StrictMode invokes twice).
  const presetsRef = useRef(presets);
  useEffect(() => {
    presetsRef.current = presets;
  }, [presets]);

  const excludeRules = state.projectExcludeRules[project.id] ?? [];
  const includeRules = state.projectIncludeRules[project.id] ?? [];
  const activeRules = mode === 'exclude' ? excludeRules : includeRules;

  const excludeCounts = useMemo(
    () => countRuleMatches(project.files, excludeRules),
    [project.files, excludeRules],
  );
  const includeCounts = useMemo(
    () => countRuleMatches(project.files, includeRules),
    [project.files, includeRules],
  );
  const deselectedTotal = useMemo(
    () => countRuleDeselected(project.files, excludeRules),
    [project.files, excludeRules],
  );
  const rescuedTotal = useMemo(
    () =>
      countRescuedByIncludes(project.files, excludeRules, includeRules),
    [project.files, excludeRules, includeRules],
  );
  const includeTotal = useMemo(
    () => countRuleSelectedTotal(project.files, includeRules),
    [project.files, includeRules],
  );

  const commit = (raw: string) => {
    const parsed = parseRuleInput(raw);
    if (parsed.length === 0) return;
    const existing = new Set(activeRules);
    const added = parsed.filter((p) => !existing.has(p));
    if (added.length === 0) {
      setDraft('');
      return;
    }
    dispatch(
      mode === 'exclude'
        ? {
            type: 'SET_PROJECT_RULES',
            projectId: project.id,
            rules: [...excludeRules, ...added],
          }
        : {
            type: 'SET_PROJECT_INCLUDE_RULES',
            projectId: project.id,
            rules: [...includeRules, ...added],
          },
    );
    setDraft('');
  };

  const removeRule = (pattern: string) => {
    if (mode === 'exclude') {
      dispatch({
        type: 'SET_PROJECT_RULES',
        projectId: project.id,
        rules: excludeRules.filter((r) => r !== pattern),
      });
    } else {
      dispatch({
        type: 'SET_PROJECT_INCLUDE_RULES',
        projectId: project.id,
        rules: includeRules.filter((r) => r !== pattern),
      });
    }
  };

  const savePreset = () => {
    if (excludeRules.length === 0 && includeRules.length === 0) return;
    const preset = createRulePreset(
      presetName || suggestPresetName(excludeRules, includeRules),
      excludeRules,
      includeRules,
    );
    setPresets((prev) => pushRulePreset(prev, preset));
    setPresetName('');
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1600);
  };

  const applyPreset = (preset: RulePreset) => {
    dispatch({
      type: 'SET_PROJECT_RULES',
      projectId: project.id,
      rules: [...preset.exclude],
    });
    dispatch({
      type: 'SET_PROJECT_INCLUDE_RULES',
      projectId: project.id,
      rules: [...preset.include],
    });
  };

  const deletePreset = (id: string) => {
    setPresets((prev) => removeRulePreset(prev, id));
  };

  /** Download every saved preset as a portable JSON file. */
  const exportPresets = () => {
    if (presets.length === 0) return;
    try {
      const json = serializeRulePresets(presets);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'codice-rule-presets.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.push({
        kind: 'success',
        title: 'Rules exported',
        message: `${presets.length} preset${presets.length === 1 ? '' : 's'} · codice-rule-presets.json`,
      });
    } catch {
      toast.push({
        kind: 'error',
        title: 'Export failed',
        message: 'The rules file could not be created.',
      });
    }
  };

  /** Read a shared JSON file and merge it into the saved presets. */
  const importPresets = async (file: File) => {
    try {
      const text = await file.text();
      const { presets: incoming, invalid } = parseRulePresets(text);
      if (incoming.length === 0) {
        toast.push({
          kind: 'warning',
          title: 'Nothing to import',
          message:
            invalid > 0
              ? `${invalid} entr${invalid === 1 ? 'y was' : 'ies were'} invalid and no usable presets remained.`
              : 'The file contains no presets.',
        });
        return;
      }
      const merged = mergeRulePresets(presetsRef.current, incoming);
      setPresets(merged.presets);
      const skipped = invalid + merged.duplicates;
      toast.push({
        kind: 'success',
        title: `Imported ${merged.added} preset${merged.added === 1 ? '' : 's'}`,
        message:
          skipped > 0
            ? `${skipped} skipped (${invalid} invalid · ${merged.duplicates} duplicate${merged.duplicates === 1 ? '' : 's'})`
            : undefined,
      });
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Import failed',
        message: err instanceof Error ? err.message : 'The file could not be read.',
      });
    } finally {
      // Reset the input so picking the same file twice still fires change.
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const suggestions =
    mode === 'exclude'
      ? RULE_SUGGESTIONS.filter((s) => !excludeRules.includes(s)).slice(0, 3)
      : INCLUDE_RULE_SUGGESTIONS.filter((s) => !includeRules.includes(s)).slice(0, 3);
  const selectedNow = getSelectedFiles(project.id).size;
  const totalCount = excludeRules.length + includeRules.length;
  const activeCounts = mode === 'exclude' ? excludeCounts : includeCounts;

  return (
    <div className="codice-rules-panel rounded-md border border-app bg-surface/40">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs text-secondary transition-colors hover:text-primary"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Glob patterns that shape the default selection"
        data-tour="rules"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <SlidersHorizontal size={13} className="text-muted" />
        <span className="font-medium">Selection rules</span>
        {totalCount > 0 && (
          <span className="badge codice-rules-badge">{totalCount}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5 tabular-nums">
          {deselectedTotal > 0 && (
            <span
              className="flex items-center gap-0.5 text-[10px] text-warning"
              title={`${deselectedTotal} file${deselectedTotal === 1 ? '' : 's'} deselected by exclude rules`}
            >
              <Ban size={10} />−{deselectedTotal}
            </span>
          )}
          {rescuedTotal > 0 && (
            <span
              className="flex items-center gap-0.5 text-[10px] text-success"
              title={`${rescuedTotal} file${rescuedTotal === 1 ? '' : 's'} rescued by include rules`}
            >
              <Check size={10} />+{rescuedTotal}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="codice-fade-in space-y-1.5 px-2 pb-2">
          {/* Exclude / Include mode switch */}
          <div className="codice-rule-modes" role="tablist" aria-label="Rule mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'exclude'}
              className="codice-rule-mode-btn"
              data-active={mode === 'exclude'}
              onClick={() => {
                setMode('exclude');
                setDraft('');
              }}
            >
              <Ban size={10} />
              Exclude {excludeRules.length > 0 && `(${excludeRules.length})`}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'include'}
              className="codice-rule-mode-btn"
              data-active={mode === 'include'}
              onClick={() => {
                setMode('include');
                setDraft('');
              }}
            >
              <Check size={10} />
              Include {includeRules.length > 0 && `(${includeRules.length})`}
            </button>
          </div>

          {activeRules.length > 0 && (
            <div className="flex flex-wrap gap-1" role="list">
              {activeRules.map((pattern, i) => (
                <span
                  key={pattern}
                  role="listitem"
                  className="codice-rule-chip"
                  data-mode={mode}
                  title={
                    activeCounts[i] > 0
                      ? mode === 'exclude'
                        ? `Deselects ${activeCounts[i]} file${activeCounts[i] === 1 ? '' : 's'}`
                        : `Re-selects ${activeCounts[i]} file${activeCounts[i] === 1 ? '' : 's'}`
                      : 'No files currently match this pattern'
                  }
                >
                  <code className="codice-rule-pattern">{pattern}</code>
                  <span className="codice-rule-count tabular-nums">
                    {activeCounts[i]}
                  </span>
                  <button
                    type="button"
                    className="codice-rule-remove"
                    aria-label={`Remove rule ${pattern}`}
                    title="Remove rule"
                    onClick={() => removeRule(pattern)}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <input
            type="text"
            className="input py-1 text-xs"
            placeholder={
              mode === 'exclude'
                ? 'Add exclude pattern — e.g. *.test.js then Enter'
                : 'Add include pattern — e.g. src/** then Enter'
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit(draft);
              } else if (e.key === 'Escape') {
                setDraft('');
              }
            }}
            onBlur={() => commit(draft)}
            aria-label={
              mode === 'exclude'
                ? 'New exclusion rule pattern'
                : 'New inclusion rule pattern'
            }
          />

          {activeRules.length === 0 && (
            <div className="flex flex-wrap gap-1">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="codice-rule-suggestion"
                  onClick={() => commit(s)}
                  title={`Add rule ${s}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <p className="text-[10px] leading-relaxed text-muted">
            {mode === 'exclude'
              ? deselectedTotal > 0
                ? `${deselectedTotal} file${deselectedTotal === 1 ? ' is' : 's are'} deselected · ${selectedNow} still selected`
                : 'Exclude patterns deselect matching files. Re-check a file to override.'
              : includeTotal > 0
                ? `Include patterns rescue ${includeTotal} matching file${includeTotal === 1 ? '' : 's'} from exclude rules${rescuedTotal > 0 ? ` (${rescuedTotal} currently rescued)` : ''}.`
                : 'Include patterns re-select files that exclude rules removed.'}
          </p>

          {/* Saved rule presets */}
          <div className="codice-rule-presets">
            <div className="flex items-center gap-1">
              <div className="relative flex-1">
                <Bookmark
                  size={10}
                  className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  type="text"
                  className="input py-0.5 pl-5 pr-1.5 text-[11px]"
                  placeholder="Preset name…"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      savePreset();
                    }
                  }}
                  aria-label="Rule preset name"
                />
              </div>
              <button
                type="button"
                className="codice-rule-save-btn"
                onClick={savePreset}
                disabled={
                  totalCount === 0 ||
                  presets.some((p) =>
                    rulePresetMatches(p, excludeRules, includeRules),
                  )
                }
                title={
                  totalCount === 0
                    ? 'Add at least one rule first'
                    : 'Save these rules as a reusable preset'
                }
              >
                {savedFlash ? <Check size={11} /> : <Save size={11} />}
                {savedFlash ? 'Saved' : 'Save'}
              </button>
              <button
                type="button"
                className="codice-rule-io-btn"
                onClick={exportPresets}
                disabled={presets.length === 0}
                title={
                  presets.length === 0
                    ? 'Save a preset first, then export to share it'
                    : `Download all ${presets.length} preset${presets.length === 1 ? '' : 's'} as JSON`
                }
                aria-label="Export rule presets as JSON"
              >
                <Download size={11} />
              </button>
              <button
                type="button"
                className="codice-rule-io-btn"
                onClick={() => importInputRef.current?.click()}
                title="Import presets from a shared JSON file"
                aria-label="Import rule presets from JSON"
              >
                <Import size={11} />
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importPresets(file);
                }}
              />
            </div>

            {presets.length > 0 && (
              <div className="flex flex-wrap gap-1" role="list">
                {presets.map((preset) => {
                  const isCurrent = rulePresetMatches(
                    preset,
                    excludeRules,
                    includeRules,
                  );
                  return (
                    <span
                      key={preset.id}
                      role="listitem"
                      className="codice-preset-chip"
                      data-current={isCurrent}
                    >
                      <button
                        type="button"
                        className="codice-preset-apply"
                        onClick={() => applyPreset(preset)}
                        title={`Apply “${preset.name}” — ${preset.exclude.length} exclude · ${preset.include.length} include`}
                        aria-label={`Apply rule preset ${preset.name}`}
                      >
                        <Bookmark size={9} />
                        {preset.name}
                        <span className="codice-preset-meta tabular-nums">
                          −{preset.exclude.length}
                          {preset.include.length > 0 &&
                            ` +${preset.include.length}`}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="codice-rule-remove"
                        aria-label={`Delete preset ${preset.name}`}
                        title="Delete preset"
                        onClick={() => deletePreset(preset.id)}
                      >
                        <X size={9} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Derive a readable default name from the patterns when the user is lazy. */
function suggestPresetName(
  exclude: readonly string[],
  include: readonly string[],
): string {
  const first = exclude[0] ?? include[0] ?? 'rules';
  return first.length <= 18 ? first : `${first.slice(0, 15)}…`;
}
