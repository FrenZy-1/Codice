'use client';

/**
 * Archive preview dialog — shows what a generated ZIP archive will contain
 * BEFORE building it.
 *
 * Used for two flows:
 *   - Source ZIP snapshot: the tree lists every selected file under its
 *     planned archive path, with sizes.
 *   - Separate-mode export: the tree lists one document per project plus a
 *     badge with the per-project file count.
 *
 * Confirming runs the actual pipeline; Escape / Cancel closes without
 * touching anything. The whole component is print-hidden and purely
 * presentational — all data comes in through `entries`.
 */

import { useEffect, useMemo, useRef } from 'react';
import {
  buildArchiveTree,
  archiveTreeStats,
  formatArchiveTree,
  formatArchiveSize,
  type ArchivePreviewEntry,
} from '@/lib/archivePreview';
import { formatBytes } from '@/lib/fileDiscovery';
import { X, Package } from '@/components/common/Icons';

export function ArchivePreviewDialog({
  open,
  title,
  subtitle,
  entries,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  entries: ArchivePreviewEntry[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <ArchivePreviewDialogInner
      title={title}
      subtitle={subtitle}
      entries={entries}
      confirmLabel={confirmLabel}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

function ArchivePreviewDialogInner({
  title,
  subtitle,
  entries,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  subtitle?: string;
  entries: ArchivePreviewEntry[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const tree = useMemo(() => buildArchiveTree(entries), [entries]);
  const stats = useMemo(() => archiveTreeStats(tree), [tree]);
  const text = useMemo(() => formatArchiveTree(tree, { meta: true }), [tree]);

  // Close on Escape; Enter on the backdrop never confirms accidentally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Focus the confirm button so keyboard users can act immediately.
  useEffect(() => {
    const raf = requestAnimationFrame(() => confirmRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="codice-print-hidden absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        className="panel codice-fade-in relative flex max-h-[85vh] w-full max-w-lg flex-col shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-app px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Package size={15} className="flex-shrink-0 text-secondary" />
            <h2 className="truncate text-sm font-semibold text-primary">{title}</h2>
          </div>
          <button onClick={onCancel} className="btn-ghost" aria-label="Close preview">
            <X size={15} />
          </button>
        </div>

        {subtitle && (
          <p className="border-b border-app px-4 py-2 text-xs text-secondary">
            {subtitle}
          </p>
        )}

        {/* Body — monospace archive tree */}
        <div className="flex-1 overflow-auto px-4 py-3">
          <div className="codice-archive-legend" aria-hidden="true">
            <span>
              <span className="codice-archive-dot" />
              archive contents
            </span>
            <span className="ml-auto normal-case tracking-normal">
              {stats.files} entr{stats.files === 1 ? 'y' : 'ies'} planned
            </span>
          </div>
          <pre
            className="codice-archive-tree"
            data-testid="archive-tree"
            aria-label="Archive contents"
          >
            {text}
          </pre>
          {entries.length === 0 && (
            <p className="text-xs text-muted">Nothing to package.</p>
          )}
        </div>

        {/* Footer — stats + actions */}
        <div className="flex items-center justify-between gap-2 border-t border-app px-4 py-3">
          <div className="min-w-0 text-[11px] text-muted" aria-live="polite">
            {stats.files} file{stats.files === 1 ? '' : 's'}
            {stats.dirs > 0 &&
              ` · ${stats.dirs} folder${stats.dirs === 1 ? '' : 's'}`}
            {stats.totalBytes > 0 && ` · ${formatBytes(stats.totalBytes)}`}
            {stats.partial && ' · document sizes finalize during export'}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <button type="button" className="btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              ref={confirmRef}
              className="btn-primary"
              onClick={onConfirm}
              disabled={stats.files === 0}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Re-export for callers that want a size formatter for badges. */
export { formatArchiveSize };
