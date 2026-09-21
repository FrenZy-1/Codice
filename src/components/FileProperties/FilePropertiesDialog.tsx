'use client';

/**
 * File Properties dialog (§7/§8/§9).
 *
 * One place to inspect and edit everything about a single source file.
 * The content-entry UI is GENERATED from the applied layout definition
 * (§8 — never hardcoded):
 *
 *   File information — name, path, language, size, line count, project,
 *                      inclusion/exclusion state.
 *   Assignment       — which section/block this file renders in (§3).
 *   Section fields   — the owning section's fields (values shared by the
 *                      whole section).
 *   Block fields     — the owning block's fields (values PER FILE; image
 *                      fields get a real image picker).
 *   Details          — the standard Description/Summary/Note attributes
 *                      (rendered by the standard flow and by description/
 *                      summary/note block nodes; hidden with a layout that
 *                      doesn't use them — "removing the node removes the
 *                      form", §8).
 *   Images           — attach, caption, reorder, remove image assets —
 *                      embedded after the code and via the fileImages node.
 *
 * The dialog remounts on every open so drafts always start from the
 * canonical state.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/components/common/Toast';
import {
  X,
  File as FileIcon,
  ImagePlus,
  Trash,
  ChevronUp,
  ChevronDown,
  Check,
} from '@/components/common/Icons';
import { formatBytes, STANDALONE_PROJECT_ID } from '@/lib/fileDiscovery';
import { templateSections } from '@/lib/customLayouts/model';
import { languageLabel } from '@/lib/languageDetection';
import { normalizeImageFiles, ACCEPTED_IMAGE_TYPES } from '@/lib/imageAssets';
import type { FileDetails } from '@/types';

export interface FilePropertiesTarget {
  projectId: string;
  fileId: string;
}

export function FilePropertiesDialog({
  target,
  onClose,
}: {
  target: FilePropertiesTarget;
  onClose: () => void;
}) {
  return <FilePropertiesDialogInner target={target} onClose={onClose} />;
}

function FilePropertiesDialogInner({
  target,
  onClose,
}: {
  target: FilePropertiesTarget;
  onClose: () => void;
}) {
  const { state, dispatch, getSelectedFiles } = useAppState();
  const toast = useToast();

  const project = state.projects.find((p) => p.id === target.projectId);
  const file = project?.files.find((f) => f.id === target.fileId);

  // Fresh mount → seed drafts from the canonical per-file state.
  const existing = state.fileDetails[target.fileId];
  const [details, setDetails] = useState<FileDetails>({
    description: existing?.description ?? '',
    summary: existing?.summary ?? '',
    note: existing?.note ?? '',
  });

  // Applied layout (v2) + the file's owning section/block (§3).
  const appliedLayout = useMemo(
    () =>
      state.customLayouts.find((t) => t.id === state.appliedLayoutId) ?? null,
    [state.customLayouts, state.appliedLayoutId],
  );
  const assignment = useMemo(() => {
    if (!appliedLayout) return null;
    for (const section of templateSections(appliedLayout)) {
      for (const child of section.children) {
        if (child.kind !== 'block') continue;
        if ((state.layoutAssignments[child.block.id] ?? []).includes(target.fileId)) {
          return { section, block: child.block };
        }
      }
    }
    return null;
  }, [appliedLayout, state.layoutAssignments, target.fileId]);

  // Dynamic field values: section scope (shared) + block scope (per file).
  const sectionValues = assignment
    ? state.sectionFieldValues[assignment.section.id] ?? {}
    : {};
  const [sectionDraft, setSectionDraft] = useState<Record<string, string>>({ ...sectionValues });
  const [blockDraft, setBlockDraft] = useState<Record<string, string>>(
    () => ({ ...(state.fileFieldValues[target.fileId] ?? {}) }),
  );
  // Sync section draft if the section changes (remount-fresh dialog — the
  // seed above already covers the normal path; this guards HMR-style reuse).
  useEffect(() => {
    setSectionDraft({ ...sectionValues });
  }, [assignment?.section.id]);

  // Line count: read lazily on open (small text files; failure → '—').
  const [lineCount, setLineCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!file?.fileHandle) return;
        const text = await file.fileHandle.getText();
        if (!cancelled) setLineCount(text.split('\n').length);
      } catch {
        if (!cancelled) setLineCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Images attached to this file (§10/§11).
  const attachedIds = state.fileImages[target.fileId] ?? [];
  const attachedAssets = attachedIds
    .map((id) => state.imageAssets.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));
  const [captions, setCaptions] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const a of attachedAssets) map[a.id] = a.caption ?? '';
    return map;
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blockImageInputRef = useRef<HTMLInputElement>(null);
  const pendingImageField = useRef<string | null>(null);
  const [importing, setImporting] = useState(false);

  // §8 — Details fields appear when the standard flow is active OR when the
  // owning block actually renders the corresponding node. Removing the node
  // from the layout removes the input (data is preserved, not requested).
  const blockNodeTypes = useMemo(() => {
    const types = new Set<string>();
    if (assignment) {
      const walk = (nodes: typeof assignment.block.nodes) => {
        for (const n of nodes) {
          types.add(n.type);
          for (const stack of n.children ?? []) walk(stack);
        }
      };
      walk(assignment.block.nodes);
    }
    return types;
  }, [assignment]);

  const showDetails = !appliedLayout
    ? true
    : assignment
      ? blockNodeTypes.has('description') ||
        blockNodeTypes.has('summary') ||
        blockNodeTypes.has('note') ||
        blockNodeTypes.has('file')
      : true;

  if (!project || !file) {
    return (
      <DialogShell onClose={onClose} label="File properties">
        <div className="px-4 py-6 text-sm text-secondary">
          This file is no longer part of the project.
        </div>
      </DialogShell>
    );
  }

  const selected = getSelectedFiles(project.id).has(file.id);
  const includedOverride = state.inclusions[project.id]?.has(file.id) ?? false;

  const save = () => {
    dispatch({ type: 'SET_FILE_DETAILS', fileId: file.id, details });
    if (assignment) {
      dispatch({
        type: 'SET_FILE_FIELD_VALUES',
        fileId: file.id,
        values: blockDraft,
      });
      dispatch({
        type: 'SET_SECTION_FIELD_VALUES',
        sectionId: assignment.section.id,
        values: sectionDraft,
      });
    }
    // Persist caption edits made here.
    for (const [id, caption] of Object.entries(captions)) {
      const asset = state.imageAssets.find((a) => a.id === id);
      if (asset && asset.caption !== caption) {
        dispatch({ type: 'UPDATE_IMAGE_ASSET', id, caption });
      }
    }
    toast.push({
      kind: 'success',
      title: 'File properties saved',
      message: `${file.name} — content updated.`,
    });
    onClose();
  };

  const handleImportImages = async (files: File[]) => {
    if (files.length === 0) return;
    setImporting(true);
    try {
      const { assets, errors } = await normalizeImageFiles(files);
      if (assets.length > 0) {
        dispatch({ type: 'ADD_IMAGE_ASSETS', assets });
        const nextIds = [
          ...attachedIds,
          ...assets.map((a) => a.id),
        ];
        dispatch({ type: 'SET_FILE_IMAGES', fileId: file.id, imageIds: nextIds });
        const capMap: Record<string, string> = {};
        for (const a of assets) capMap[a.id] = '';
        setCaptions((c) => ({ ...c, ...capMap }));
      }
      for (const e of errors) {
        toast.push({ kind: 'error', title: 'Image skipped', message: e });
      }
    } finally {
      setImporting(false);
    }
  };

  /** Import an image for a BLOCK image field (per-file field value). */
  const handleBlockImagePick = (fileList: FileList | null) => {
    const fieldId = pendingImageField.current;
    pendingImageField.current = null;
    if (!fieldId || !fileList || fileList.length === 0) return;
    void normalizeImageFiles(Array.from(fileList)).then(({ assets }) => {
      if (assets.length > 0) {
        dispatch({ type: 'ADD_IMAGE_ASSETS', assets });
        setBlockDraft((v) => ({ ...v, [fieldId]: assets[0].id }));
      }
    });
  };

  const moveImage = (index: number, delta: number) => {
    const next = [...attachedIds];
    const to = index + delta;
    if (to < 0 || to >= next.length) return;
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved);
    dispatch({ type: 'SET_FILE_IMAGES', fileId: file.id, imageIds: next });
  };

  const removeImage = (id: string) => {
    dispatch({
      type: 'SET_FILE_IMAGES',
      fileId: file.id,
      imageIds: attachedIds.filter((x) => x !== id),
    });
  };

  const infoRows: Array<[string, string]> = [
    ['File name', file.name],
    ['Relative path', file.relativePath],
    ['Language', file.language ? languageLabel(file.language) : '—'],
    ['Size', formatBytes(file.size)],
    ['Lines', lineCount === null ? '—' : String(lineCount)],
    ['Project', project.label],
    [
      'Status',
      selected
        ? includedOverride
          ? 'Included (explicit)'
          : 'Included'
        : file.excluded
          ? `Excluded${file.exclusionReason ? ` — ${file.exclusionReason}` : ''}`
          : 'Excluded (manual)',
    ],
  ];

  const renderFieldInput = (
    f: { id: string; label: string; kind: string; required: boolean },
    value: string,
    onChange: (v: string) => void,
  ) => {
    if (f.kind === 'image') {
      return (
        <div className="flex flex-wrap items-center gap-2">
          {value ? (
            <img
              src={state.imageAssets.find((a) => a.id === value)?.dataUrl}
              alt={f.label}
              className="h-14 w-20 rounded border border-app object-cover"
            />
          ) : (
            <span className="text-[11px] text-muted">No image selected</span>
          )}
          <button
            type="button"
            className="codice-bulk-btn"
            onClick={() => {
              pendingImageField.current = f.id;
              blockImageInputRef.current?.click();
            }}
          >
            <ImagePlus size={11} />
            {value ? 'Replace' : 'Add image'}
          </button>
          {value && (
            <button
              type="button"
              className="codice-bulk-btn"
              onClick={() => onChange('')}
            >
              <Trash size={11} /> Remove
            </button>
          )}
        </div>
      );
    }
    if (f.kind === 'textarea') {
      return (
        <textarea
          className="input min-h-[64px] resize-y"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
    return (
      <input
        type="text"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  };

  return (
    <DialogShell onClose={onClose} label={`File properties — ${file.name}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-app px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileIcon size={15} className="flex-shrink-0 text-secondary" />
          <h2 className="truncate text-sm font-semibold text-primary">
            {file.name}
          </h2>
          <span className="badge flex-shrink-0">properties</span>
        </div>
        <button onClick={onClose} className="btn-ghost" aria-label="Close">
          <X size={15} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-5 overflow-auto px-4 py-4">
        {/* File information (§7) */}
        <section aria-label="File information">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-secondary">
            File information
          </h3>
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 rounded-md border border-app bg-app/40 p-3 text-xs">
            {infoRows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="min-w-0 break-words text-secondary">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Assignment + dynamic layout fields (§3/§4/§8) */}
        {appliedLayout && (
          <section aria-label="Applied layout content">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-secondary">
              “{appliedLayout.name}” layout content
            </h3>
            {!assignment ? (
              <p className="rounded-md border border-dashed border-app px-3 py-3 text-[11px] text-muted">
                This file is not assigned to any block of the applied layout —
                assign it in the Layout studio’s File layout editor to include
                it (and to expose its fields here).
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-[11px] text-secondary">
                  Renders in{' '}
                  <strong className="text-primary">{assignment.section.name}</strong>{' '}
                  → block <strong className="text-primary">{assignment.block.name}</strong>
                </p>
                {assignment.section.fields.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Section fields — shared by the whole section
                    </div>
                    {assignment.section.fields.map((f) => (
                      <div key={f.id} className="space-y-1">
                        <label className="label block">
                          {f.label}
                          {f.required ? (
                            <span className="ml-1 text-[10px] font-semibold text-warning" title="Required before export">
                              required
                            </span>
                          ) : (
                            <span className="ml-1 text-[10px] text-muted">optional</span>
                          )}
                        </label>
                        {renderFieldInput(f, sectionDraft[f.id] ?? '', (v) =>
                          setSectionDraft((s) => ({ ...s, [f.id]: v })),
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {assignment.block.fields.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Block fields — stored for this file only
                    </div>
                    {assignment.block.fields.map((f) => (
                      <div key={f.id} className="space-y-1">
                        <label className="label block">
                          {f.label}
                          {f.required ? (
                            <span className="ml-1 text-[10px] font-semibold text-warning" title="Required before export">
                              required
                            </span>
                          ) : (
                            <span className="ml-1 text-[10px] text-muted">optional</span>
                          )}
                        </label>
                        {renderFieldInput(f, blockDraft[f.id] ?? '', (v) =>
                          setBlockDraft((s) => ({ ...s, [f.id]: v })),
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {assignment.section.fields.length === 0 &&
                  assignment.block.fields.length === 0 && (
                    <p className="text-[11px] text-muted">
                      This section/block defines no custom fields.
                    </p>
                  )}
              </div>
            )}
          </section>
        )}

        {/* Standard details (§6) — hidden when the layout doesn't use them */}
        {showDetails && (
          <section aria-label="User-defined details">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-secondary">
              Details
            </h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="label block">
                  Description <span className="text-muted">— shown before the code</span>
                </label>
                <textarea
                  className="input min-h-[64px] resize-y"
                  placeholder="Introduces this file's purpose…"
                  value={details.description ?? ''}
                  onChange={(e) =>
                    setDetails((d) => ({ ...d, description: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <label className="label block">
                  Summary <span className="text-muted">— shown after the code</span>
                </label>
                <textarea
                  className="input min-h-[64px] resize-y"
                  placeholder="Recaps what the code does…"
                  value={details.summary ?? ''}
                  onChange={(e) =>
                    setDetails((d) => ({ ...d, summary: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <label className="label block">
                  Note <span className="text-muted">— shown after the summary</span>
                </label>
                <textarea
                  className="input min-h-[52px] resize-y"
                  placeholder="Additional remarks, caveats…"
                  value={details.note ?? ''}
                  onChange={(e) =>
                    setDetails((d) => ({ ...d, note: e.target.value }))
                  }
                />
              </div>
            </div>
          </section>
        )}

        {/* Images (§10/§11) — attach/caption/reorder/remove */}
        <section aria-label="Images">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
              Images <span className="text-muted normal-case">— shown after the code / via the File images node</span>
            </h3>
            <button
              type="button"
              className="codice-bulk-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              <ImagePlus size={11} />
              {importing ? 'Importing…' : 'Add image'}
            </button>
          </div>
          {attachedAssets.length === 0 ? (
            <p className="rounded-md border border-dashed border-app px-3 py-3 text-center text-[11px] text-muted">
              No images attached. PNG, JPEG, WebP, GIF and SVG are accepted —
              they are normalized for all three export formats.
            </p>
          ) : (
            <ul className="space-y-2">
              {attachedAssets.map((asset, i) => (
                <li
                  key={asset.id}
                  className="flex items-start gap-2 rounded-md border border-app bg-app/40 p-2"
                >
                  <img
                    src={asset.dataUrl}
                    alt={asset.caption || asset.name}
                    className="h-16 w-24 flex-shrink-0 rounded border border-app object-cover"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[11px] text-secondary">
                        {asset.name}
                      </span>
                      <span className="text-[10px] tabular-nums text-muted">
                        {asset.width}×{asset.height}
                      </span>
                    </div>
                    <input
                      type="text"
                      className="input py-0.5 text-xs"
                      placeholder="Caption (optional)"
                      value={captions[asset.id] ?? ''}
                      onChange={(e) =>
                        setCaptions((c) => ({ ...c, [asset.id]: e.target.value }))
                      }
                    />
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="codice-bulk-btn"
                        onClick={() => moveImage(i, -1)}
                        disabled={i === 0}
                        aria-label={`Move ${asset.name} earlier`}
                        title="Move earlier"
                      >
                        <ChevronUp size={11} />
                      </button>
                      <button
                        type="button"
                        className="codice-bulk-btn"
                        onClick={() => moveImage(i, 1)}
                        disabled={i === attachedAssets.length - 1}
                        aria-label={`Move ${asset.name} later`}
                        title="Move later"
                      >
                        <ChevronDown size={11} />
                      </button>
                      <button
                        type="button"
                        className="codice-bulk-btn"
                        onClick={() => removeImage(asset.id)}
                        aria-label={`Remove ${asset.name}`}
                        title="Remove from file"
                      >
                        <Trash size={11} />
                      </button>
                      <span className="ml-auto text-[10px] text-muted">
                        {i + 1}/{attachedAssets.length}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-app px-4 py-3">
        <span className="text-[10px] text-muted">
          {project.id === STANDALONE_PROJECT_ID
            ? 'Standalone file'
            : `Part of ${project.label}`}
        </span>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save}>
            <Check size={14} />
            Save
          </button>
        </div>
      </div>

      {/* Shared image import inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        multiple
        className="hidden"
        aria-label="Import images"
        onChange={(e) => {
          void handleImportImages(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <input
        ref={blockImageInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        multiple
        className="hidden"
        aria-label="Import image for field"
        onChange={(e) => {
          handleBlockImagePick(e.target.files);
          e.target.value = '';
        }}
      />
    </DialogShell>
  );
}

/** Shared modal shell (same visual language as MetadataDialog). */
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="panel relative flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {children}
      </div>
    </div>
  );
}
