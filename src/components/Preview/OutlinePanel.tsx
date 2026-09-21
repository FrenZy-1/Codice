'use client';

/**
 * Floating document-outline panel for the main preview.
 *
 * Lists every preview section (title page / TOC / projects / files) with a
 * scroll-spy active highlight. Clicking a row smooth-scrolls the preview
 * container to the matching `[data-outline-id]` anchor.
 */

import { useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import {
  formatOutlineText,
  outlineGlyph,
  outlineKindTone,
  type OutlineEntry,
} from '@/lib/documentOutline';
import { moveFileInOrder } from '@/lib/documentOrder';
import { useToast } from '@/components/common/Toast';
import { X, Copy, Check, ChevronUp, ChevronDown } from '@/components/common/Icons';

export function OutlinePanel({
  entries,
  activeId,
  onNavigate,
  onClose,
  style,
}: {
  entries: OutlineEntry[];
  /** Currently top-most visible section (scroll-spy). */
  activeId: string | null;
  onNavigate: (id: string) => void;
  onClose: () => void;
  /** Optional inline overrides (the preview renders the panel in flow). */
  style?: React.CSSProperties;
}) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  // §14 — file reorder from the Outline. SAME canonical state as the
  // sidebar's Document order panel: fileOrder[projectId] (§13).
  const { state, dispatch } = useAppState();

  const moveFile = (entry: OutlineEntry, delta: number) => {
    if (!entry.fileId || !entry.projectId) return;
    const project = state.projects.find((p) => p.id === entry.projectId);
    if (!project) return;
    const order = moveFileInOrder(
      state.fileOrder[entry.projectId],
      project.files,
      entry.fileId,
      delta,
    );
    dispatch({
      type: 'SET_FILE_ORDER',
      projectId: entry.projectId,
      order,
    });
  };

  const copyOutline = async () => {
    const text = formatOutlineText(entries);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
    } catch {
      toast.push({
        kind: 'error',
        title: 'Copy failed',
        message: 'The clipboard is unavailable in this browser context.',
      });
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
    toast.push({
      kind: 'success',
      title: 'Outline copied',
      message: `${entries.length} sections as indented text`,
    });
  };

  return (
    <aside
      className="codice-outline-panel codice-print-hidden"
      aria-label="Document outline"
      role="navigation"
      style={style}
    >
      <header className="flex items-center gap-2 border-b border-app px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
          Outline
        </span>
        <span className="rounded-full border border-app px-1.5 text-[10px] text-muted">
          {entries.length}
        </span>
        {entries.length > 0 && (
          <button
            type="button"
            className="codice-copy-stats-btn ml-1 h-[18px] w-[18px]"
            data-copied={copied}
            aria-label="Copy outline as text"
            title="Copy outline as text"
            onClick={() => void copyOutline()}
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
          </button>
        )}
        <button
          type="button"
          className="btn-ghost ml-auto"
          onClick={onClose}
          aria-label="Close outline"
          title="Close outline (Ctrl+O)"
        >
          <X size={13} />
        </button>
      </header>

      <div className="codice-outline-list" role="list">
        {entries.map((entry) => {
          const reorderable =
            entry.kind === 'file' && Boolean(entry.fileId && entry.projectId);
          return (
          <div
            key={entry.id}
            className="codice-outline-row-wrapper flex items-center"
          >
          <button
            type="button"
            role="listitem"
            className="codice-outline-row"
            style={{ paddingLeft: 8 + entry.depth * 14 }}
            data-active={activeId === entry.id}
            data-kind={entry.kind}
            data-outline-row={entry.id}
            onClick={() => onNavigate(entry.id)}
            title={entry.tooltip ?? (entry.detail ? `${entry.label} · ${entry.detail}` : entry.label)}
          >
            <span
              className="codice-outline-glyph"
              data-tone={outlineKindTone(entry.kind)}
              aria-hidden="true"
            >
              {outlineGlyph(entry.kind)}
            </span>
            <span className="codice-outline-label">{entry.label}</span>
            {entry.detail && (
              <span className="codice-outline-badge">{entry.detail}</span>
            )}
          </button>
          {reorderable && (
            <span className="codice-outline-reorder" aria-hidden={false}>
              <button
                type="button"
                className="codice-outline-reorder-btn"
                title={`Move ${entry.label} earlier in the document`}
                aria-label={`Move ${entry.label} earlier in the document`}
                onClick={(e) => {
                  e.stopPropagation();
                  moveFile(entry, -1);
                }}
              >
                <ChevronUp size={11} />
              </button>
              <button
                type="button"
                className="codice-outline-reorder-btn"
                title={`Move ${entry.label} later in the document`}
                aria-label={`Move ${entry.label} later in the document`}
                onClick={(e) => {
                  e.stopPropagation();
                  moveFile(entry, 1);
                }}
              >
                <ChevronDown size={11} />
              </button>
            </span>
          )}
          </div>
          );
        })}
      </div>

      <footer className="border-t border-app px-3 py-1.5 text-[10px] text-muted">
        Click a row to jump · active row follows scroll
      </footer>
    </aside>
  );
}
