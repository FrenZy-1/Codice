'use client';

/**
 * Document metadata quick-edit dialog.
 *
 * Lets the user edit title-page metadata (title, subtitle, author, course,
 * university, date, version, description) from the top bar without opening
 * the full template editor. Writes to the SAME canonical metadata state the
 * preview and exporters consume.
 *
 * The inner dialog remounts on every open, so the draft always starts from
 * the current metadata without effect-based state syncing.
 */

import { useEffect, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/components/common/Toast';
import { X, FileText } from '@/components/common/Icons';
import type { DocumentMetadata } from '@/types';

const FIELDS: Array<{
  key: keyof DocumentMetadata;
  label: string;
  placeholder: string;
  long?: boolean;
}> = [
  { key: 'title', label: 'Title', placeholder: 'Project Report' },
  { key: 'subtitle', label: 'Subtitle', placeholder: 'A practical guide…' },
  { key: 'author', label: 'Author', placeholder: 'Jane Doe' },
  { key: 'course', label: 'Course', placeholder: 'CS 402 — Software Engineering' },
  { key: 'university', label: 'University', placeholder: 'State University' },
  { key: 'date', label: 'Date', placeholder: '(today)' },
  { key: 'version', label: 'Version', placeholder: 'v1.0.0' },
  { key: 'description', label: 'Description', placeholder: 'Short description of the document…', long: true },
];

export function MetadataDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <MetadataDialogInner onClose={onClose} />;
}

function MetadataDialogInner({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useAppState();
  const toast = useToast();
  // Fresh mount on open → seed directly from the canonical state.
  const [draft, setDraft] = useState<DocumentMetadata>(state.metadata);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    dispatch({ type: 'SET_METADATA', metadata: draft });
    toast.push({
      kind: 'success',
      title: 'Document info saved',
      message: 'The title page now uses the updated metadata.',
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="panel relative flex max-h-[85vh] w-full max-w-lg flex-col shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Document info"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-app px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText size={15} className="text-secondary" />
            <h2 className="text-sm font-semibold text-primary">Document Info</h2>
            <span className="badge">title page metadata</span>
          </div>
          <button onClick={onClose} className="btn-ghost" aria-label="Close">
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-3 overflow-auto px-4 py-4">
          {FIELDS.map(({ key, label, placeholder, long }) => (
            <div key={key} className="space-y-1">
              <label className="label block">{label}</label>
              {long ? (
                <textarea
                  className="input min-h-[72px] resize-y"
                  placeholder={placeholder}
                  value={draft[key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                />
              ) : (
                <input
                  autoFocus={key === 'title'}
                  type="text"
                  className="input"
                  placeholder={placeholder}
                  value={draft[key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) save();
                  }}
                />
              )}
            </div>
          ))}
          <p className="text-[10px] text-muted">
            Tip: show or hide each field on the title page in the Layout studio —
            Page &amp; Layout → Title Page (visibility toggles).
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-app px-4 py-3">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
