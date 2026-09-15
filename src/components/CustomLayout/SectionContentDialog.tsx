'use client';

/**
 * Section content dialog (§2/§8) — fills the SECTION-scope field values of
 * one layout section. The form is GENERATED from the section's field
 * definitions (never hardcoded): text inputs, textareas and image pickers
 * follow the fields the user defined.
 *
 * Used from the File Layout editor ("Fill content" on a section card) and
 * from the export rail when validation reports missing section fields.
 */

import { useEffect, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/components/common/Toast';
import { X, Check, ImagePlus, Trash } from '@/components/common/Icons';
import { normalizeImageFiles, ACCEPTED_IMAGE_TYPES } from '@/lib/imageAssets';
import type { TemplateFieldDefinition } from '@/lib/customLayouts/model';

export function SectionContentDialog({
  sectionId,
  sectionName,
  fields,
  onClose,
}: {
  sectionId: string;
  sectionName: string;
  fields: TemplateFieldDefinition[];
  onClose: () => void;
}) {
  const { state, dispatch } = useAppState();
  const toast = useToast();
  const existing = state.sectionFieldValues[sectionId] ?? {};
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...existing }));
  const [importing, setImporting] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingImageField = useRef<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    dispatch({ type: 'SET_SECTION_FIELD_VALUES', sectionId, values });
    toast.push({
      kind: 'success',
      title: 'Section content saved',
      message: `“${sectionName}” — ${fields.length} field${fields.length === 1 ? '' : 's'} updated.`,
    });
    onClose();
  };

  const handlePickImage = (fileList: FileList | null) => {
    const fieldId = pendingImageField.current;
    pendingImageField.current = null;
    if (!fieldId || !fileList || fileList.length === 0) return;
    setImporting(true);
    void normalizeImageFiles(Array.from(fileList))
      .then(({ assets }) => {
        if (assets.length > 0) {
          dispatch({ type: 'ADD_IMAGE_ASSETS', assets });
          setValues((v) => ({ ...v, [fieldId]: assets[0].id }));
        }
      })
      .finally(() => setImporting(false));
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="panel relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={`Section content — ${sectionName}`}
      >
        <div className="flex items-center justify-between border-b border-app px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-primary">{sectionName}</h2>
            <p className="text-[10px] text-muted">
              Section content — shared by every file in this section
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost" aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-auto px-4 py-4">
          {fields.length === 0 && (
            <p className="rounded-md border border-dashed border-app px-3 py-4 text-center text-xs text-muted">
              This section has no fields yet — add them in the section editor.
            </p>
          )}
          {fields.map((f) => (
            <div key={f.id} className="space-y-1">
              <label className="label block" htmlFor={`sc-field-${f.id}`}>
                {f.label}
                {f.required ? (
                  <span className="ml-1 text-[10px] font-semibold text-warning" title="Required before export">
                    required
                  </span>
                ) : (
                  <span className="ml-1 text-[10px] text-muted">optional</span>
                )}
              </label>
              {f.kind === 'image' ? (
                <div className="flex flex-wrap items-center gap-2">
                  {values[f.id] ? (
                    <img
                      src={state.imageAssets.find((a) => a.id === values[f.id])?.dataUrl}
                      alt={f.label}
                      className="h-14 w-20 rounded border border-app object-cover"
                    />
                  ) : (
                    <span className="text-[11px] text-muted">No image selected</span>
                  )}
                  <button
                    type="button"
                    className="codice-bulk-btn"
                    disabled={importing}
                    onClick={() => {
                      pendingImageField.current = f.id;
                      imageInputRef.current?.click();
                    }}
                  >
                    <ImagePlus size={11} />
                    {values[f.id] ? 'Replace' : 'Add image'}
                  </button>
                  {values[f.id] && (
                    <button
                      type="button"
                      className="codice-bulk-btn"
                      onClick={() => setValues((v) => ({ ...v, [f.id]: '' }))}
                    >
                      <Trash size={11} /> Remove
                    </button>
                  )}
                </div>
              ) : f.kind === 'textarea' ? (
                <textarea
                  id={`sc-field-${f.id}`}
                  className="input min-h-[64px] resize-y"
                  value={values[f.id] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                />
              ) : (
                <input
                  id={`sc-field-${f.id}`}
                  type="text"
                  className="input"
                  value={values[f.id] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-app px-4 py-3">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save}>
            <Check size={14} />
            Save
          </button>
        </div>

        <input
          ref={imageInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          multiple
          className="hidden"
          aria-label="Import image for field"
          onChange={(e) => {
            handlePickImage(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
