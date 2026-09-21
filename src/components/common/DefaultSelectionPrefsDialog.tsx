'use client';

/**
 * Default file-selection preferences dialog (§46).
 *
 * Lets the user define which files are selected AUTOMATICALLY when
 * projects are uploaded:
 *   - default excluded extensions   (e.g. csv, log)
 *   - default force-included extensions (e.g. kt, java)
 *   - default exclude patterns      (gitignore-like, e.g. build/**)
 *   - default include patterns      (e.g. ** /*.kt)
 *   - default excluded directories  (e.g. vendor, .gradle)
 *
 * Precedence is displayed in the dialog: default rules → project/import
 * rules → manual per-file overrides. Prefs persist across sessions and are
 * applied at upload time only — changing them never rewrites
 * already-loaded projects.
 */

import { useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { X } from '@/components/common/Icons';
import {
  loadDefaultSelectionPrefs,
  parsePrefList,
  parsePrefPatterns,
  type DefaultSelectionPrefs,
} from '@/lib/defaultSelectionPrefs';

const PRECEDENCE_STEPS = [
  '1. Default rules (this dialog)',
  '2. Project / import selection rules',
  '3. Manual include/exclude overrides (always win)',
] as const;

export function DefaultSelectionPrefsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { dispatch } = useAppState();
  const [prefs, setPrefs] = useState<DefaultSelectionPrefs>(() =>
    loadDefaultSelectionPrefs(),
  );
  const [saved, setSaved] = useState(false);

  if (!open) return null;

  const set = (patch: Partial<DefaultSelectionPrefs>) => {
    setPrefs((p) => ({ ...p, ...patch }));
    setSaved(false);
  };

  const handleSave = () => {
    dispatch({ type: 'SAVE_DEFAULT_SELECTION_PREFS', prefs });
    setSaved(true);
    window.setTimeout(onClose, 450);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="panel relative flex max-h-[86vh] w-full max-w-xl flex-col overflow-hidden shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Default file selection preferences"
      >
        <div className="flex items-center gap-2 border-b border-app px-4 py-3">
          <h2 className="text-sm font-semibold text-primary">
            Default file selection
          </h2>
          <button
            type="button"
            className="btn-ghost ml-auto"
            onClick={onClose}
            aria-label="Close default file selection preferences"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-xs text-secondary">
            These rules decide which files are selected automatically when you upload a
            project. They prevent &ldquo;134 files detected, 7 actually useful&rdquo; situations.
          </p>

          <div className="rounded-md border border-app bg-app/40 p-2 text-[11px] text-muted">
            <div className="mb-1 font-semibold uppercase tracking-wide">Precedence</div>
            {PRECEDENCE_STEPS.map((s) => (
              <div key={s}>{s}</div>
            ))}
          </div>

          <PrefField
            label="Default excluded extensions"
            hint="Never selected on upload. Comma separated: csv, log, tmp"
            value={prefs.excludeExtensions.join(', ')}
            onChange={(v) => set({ excludeExtensions: parsePrefList(v) })}
          />
          <PrefField
            label="Default included extensions (force-include)"
            hint="Always selected even when defaults exclude them: kt, java, cpp"
            value={prefs.includeExtensions.join(', ')}
            onChange={(v) => set({ includeExtensions: parsePrefList(v) })}
          />
          <PrefField
            label="Default exclude patterns"
            hint="Gitignore-like patterns, one per line: build/**, node_modules/**"
            value={prefs.excludePatterns.join('\n')}
            onChange={(v) => set({ excludePatterns: parsePrefPatterns(v) })}
            multiline
          />
          <PrefField
            label="Default include patterns"
            hint="Force-include patterns, one per line: ** /*.kt, src/**"
            value={prefs.includePatterns.join('\n')}
            onChange={(v) => set({ includePatterns: parsePrefPatterns(v) })}
            multiline
          />
          <PrefField
            label="Default excluded directories"
            hint="Directory names excluded from any upload: vendor, .gradle, dist"
            value={prefs.excludeDirectories.join(', ')}
            onChange={(v) => set({ excludeDirectories: parsePrefList(v) })}
          />

          <p className="text-[10px] text-muted">
            Changing defaults does NOT re-scan projects that are already loaded — the
            rules apply the next time you upload. You can always include/exclude
            individual files afterwards.
          </p>
        </div>

        <div className="flex items-center gap-2 border-t border-app px-4 py-3">
          <span className="text-[11px] text-success" role="status">
            {saved ? 'Saved — applies to the next upload' : ''}
          </span>
          <button type="button" className="btn-secondary ml-auto" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleSave}>
            Save defaults
          </button>
        </div>
      </div>
    </div>
  );
}

function PrefField({
  label,
  hint,
  value,
  onChange,
  multiline,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="label mb-1 block">{label}</label>
      {multiline ? (
        <textarea
          className="input min-h-[64px] font-mono text-xs"
          value={value}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <input
          type="text"
          className="input text-xs"
          value={value}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      )}
      <p className="mt-0.5 text-[10px] text-muted">{hint}</p>
    </div>
  );
}
