'use client';

/**
 * Merge projects dialog (§11).
 *
 * Merging is an EXPLICIT user action: pick a source project plus the
 * others to fold into it, and a single unified project replaces them.
 * File ids, relative paths and handles are preserved — duplicate filenames
 * from different sources stay independently addressable, and section /
 * block assignments (keyed by file id) survive the merge. Fully undoable
 * via the merged project's Unmerge action.
 */

import { useEffect, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { X, Merge, Check } from '@/components/common/Icons';

export function MergeProjectsDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const { state, dispatch } = useAppState();
  const source = state.projects.find((p) => p.id === projectId);
  const others = state.projects.filter((p) => p.id !== projectId);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!source) {
    return (
      <DialogShell onClose={onClose} label="Merge projects">
        <div className="px-4 py-6 text-sm text-secondary">This project no longer exists.</div>
      </DialogShell>
    );
  }

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const merge = () => {
    const sourceIds = [projectId, ...picked];
    dispatch({
      type: 'MERGE_PROJECTS',
      sourceIds,
      label: sourceIds
        .map((id) => state.projects.find((p) => p.id === id)?.label ?? '')
        .filter(Boolean)
        .join(' + '),
      mergedId: `proj-merged-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
    });
    onClose();
  };

  const totalFiles =
    source.files.length +
    others.filter((p) => picked.has(p.id)).reduce((acc, p) => acc + p.files.length, 0);

  return (
    <DialogShell onClose={onClose} label={`Merge projects into ${source.label}`}>
      <div className="flex items-center justify-between border-b border-app px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Merge size={15} className="flex-shrink-0 text-secondary" />
          <h2 className="truncate text-sm font-semibold text-primary">Merge projects</h2>
          <span className="badge flex-shrink-0">{source.label}</span>
        </div>
        <button onClick={onClose} className="btn-ghost" aria-label="Close">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-auto px-4 py-4">
        <p className="text-xs leading-relaxed text-secondary">
          Merging replaces the selected projects with ONE unified project
          containing all their files. File identities are preserved (duplicate
          names stay separate) and the merge can be undone afterwards with the{' '}
          <strong className="text-primary">Unmerge</strong> action.
        </p>
        {others.length === 0 ? (
          <p className="rounded-md border border-dashed border-app px-3 py-4 text-center text-xs text-muted">
            There are no other projects to merge with.
          </p>
        ) : (
          <ul className="space-y-1" aria-label="Projects to merge">
            {others.map((p) => {
              const on = picked.has(p.id);
              return (
                <li key={p.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs transition-colors ${
                      on ? 'border-[var(--color-accent)] bg-app' : 'border-app hover:bg-app'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      checked={on}
                      onChange={() => toggle(p.id)}
                    />
                    <span className="min-w-0 flex-1 truncate text-primary">{p.label}</span>
                    <span className="flex-shrink-0 text-[10px] text-muted">
                      {p.files.length} files
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[10px] text-muted">
          Result: “{source.label}
          {[...picked]
            .map((id) => state.projects.find((p) => p.id === id)?.label)
            .filter(Boolean)
            .map((l) => ` + ${l}`)}
          ” with {totalFiles} file{totalFiles === 1 ? '' : 's'}.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-app px-4 py-3">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" onClick={merge} disabled={picked.size === 0}>
          <Check size={14} />
          Merge {picked.size + 1} project{picked.size + 1 === 1 ? '' : 's'}
        </button>
      </div>
    </DialogShell>
  );
}

function DialogShell({
  children,
  onClose,
  label,
}: {
  children: React.ReactNode;
  onClose: () => void;
  label: string;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="panel relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {children}
      </div>
    </div>
  );
}
