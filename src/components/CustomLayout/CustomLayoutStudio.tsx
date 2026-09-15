'use client';

/**
 * Custom Layout Studio v2 (§0-§9).
 *
 * A visual document-template designer organized as the three-level
 * hierarchy the layout architecture defines:
 *
 *   File Layout   — ordered SECTIONS (the document skeleton) + file
 *                   assignment tray
 *   Section       — typed section editor: fields, standalone content,
 *                   block references, file assignment
 *   Block Editor  — the per-file pattern: nodes + block fields (the
 *                   original block editor, integrated — §9)
 *
 * Everything edits a local DRAFT template; "Save" persists (storage.ts v2)
 * and "Apply" marks it as the active document layout. File → block
 * assignment lives in APP STATE (session-scoped — file ids die with
 * uploads) and is enforced one-file-one-section (§3).
 *
 * Onboarding (§0): the tour opens automatically the first time the studio
 * opens and can always be reopened via the "?" button.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/components/common/Toast';
import {
  X,
  Plus,
  Trash,
  Copy,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  Upload,
  Save,
  Play,
  Layers,
  HelpCircle,
  FileText,
} from '@/components/common/Icons';
import {
  SECTION_TYPE_PRESETS,
  cloneTemplate,
  createBlockDef,
  createEmptyTemplate,
  createExampleTemplate,
  createSection,
  genLayoutId,
  type CustomLayoutTemplate,
  type SectionChild,
  type SectionTypeId,
  type TemplateFieldDefinition,
  type TemplateNode,
} from '@/lib/customLayouts/model';
import {
  loadCustomLayouts,
  deleteCustomLayout as persistDelete,
  duplicateCustomLayout as persistDuplicate,
  exportLayoutJson,
  importLayoutJson,
  renameCustomLayout as persistRename,
} from '@/lib/customLayouts/storage';
import {
  resolveCustomLayout,
  type ResolutionInputs,
} from '@/lib/customLayouts/resolver';
import {
  validateCustomLayout,
  formatMissingRequirements,
  unassignedFileIds,
} from '@/lib/customLayouts/validation';
import { effectiveFileOrder } from '@/lib/documentOrder';
import {
  NodeTreeEditor,
  findContainer,
  findNodeList,
  makeNode,
  useCollapseState,
} from '@/components/CustomLayout/NodeTreeEditor';
import { ResolvedPreview } from '@/components/CustomLayout/ResolvedPreview';
import {
  LayoutOnboarding,
  isLayoutTourDone,
  markLayoutTourDone,
} from '@/components/CustomLayout/LayoutOnboarding';
import { SectionContentDialog } from '@/components/CustomLayout/SectionContentDialog';

type StudioView =
  | { view: 'file' }
  | { view: 'section'; sectionId: string }
  | { view: 'block'; sectionId: string; blockId: string };

export function CustomLayoutStudio({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return <StudioInner onClose={onClose} />;
}

function StudioInner({ onClose }: { onClose: () => void }) {
  const { state, dispatch, getSelectedFiles } = useAppState();
  const toast = useToast();

  // ---- Draft state (remount-fresh, like the other dialogs) ----
  const [draft, setDraft] = useState<CustomLayoutTemplate | null>(() => {
    const applied = state.customLayouts.find((t) => t.id === state.appliedLayoutId);
    if (applied) return cloneTemplate(applied);
    if (state.customLayouts.length > 0) return cloneTemplate(state.customLayouts[0]);
    return null;
  });
  const [nav, setNav] = useState<StudioView>({ view: 'file' });
  const [collapsed, toggleCollapse] = useCollapseState();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contentDialog, setContentDialog] = useState<{
    sectionId: string;
    sectionName: string;
    fields: TemplateFieldDefinition[];
  } | null>(null);

  // ---- Onboarding (§0) — auto-opens the FIRST time the studio opens and
  // can always be reopened via the "?" button (never dismissible-forever). ----
  const [tourOpen, setTourOpen] = useState(() => !isLayoutTourDone());
  const [tourKey, setTourKey] = useState(0);
  const finishTour = () => {
    markLayoutTourDone();
    setTourOpen(false);
  };
  const reopenTour = () => {
    setTourKey((k) => k + 1);
    setTourOpen(true);
  };

  // Plain-text cache for the studio preview's code placeholders.
  const fileTextCache = useRef(new Map<string, string>());
  const [, setFileTextTick] = useState(0);
  const importInputRef = useRef<HTMLInputElement>(null);

  const update = (fn: (t: CustomLayoutTemplate) => void) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneTemplate(prev);
      fn(next);
      next.updatedAt = Date.now();
      return next;
    });
  };

  // ---- Template CRUD (persisted via storage.ts; state synced once) ----
  const handleNew = () => {
    const t = createEmptyTemplate(`Layout ${state.customLayouts.length + 1}`);
    setDraft(t);
    setNav({ view: 'file' });
    toast.push({ kind: 'info', title: 'Template created', message: `${t.name} — add sections and assign files.` });
  };

  const handleExample = () => {
    const t = createExampleTemplate();
    setDraft(t);
    setNav({ view: 'file' });
    toast.push({
      kind: 'info',
      title: 'Example layout loaded',
      message: 'Assign files to the Code block in the File Layout editor to see it work.',
    });
  };

  const handleSave = () => {
    if (!draft) return;
    const exists = state.customLayouts.some((t) => t.id === draft.id);
    if (exists) {
      dispatch({ type: 'UPDATE_CUSTOM_LAYOUT', template: cloneTemplate(draft) });
    } else {
      dispatch({ type: 'SAVE_CUSTOM_LAYOUT', template: cloneTemplate(draft) });
    }
    toast.push({
      kind: 'success',
      title: 'Layout saved',
      message: exists ? draft.name : `${draft.name} — saved and applied.`,
    });
  };

  const handleApply = () => {
    if (!draft) return;
    handleSave();
    dispatch({ type: 'SET_APPLIED_LAYOUT', layoutId: draft.id });
    toast.push({
      kind: 'success',
      title: 'Layout applied',
      message: `${draft.name} now drives the preview and exports.`,
    });
  };

  const handleUnapply = () => {
    dispatch({ type: 'SET_APPLIED_LAYOUT', layoutId: null });
    toast.push({ kind: 'info', title: 'Custom layout removed', message: 'The standard document flow is active again.' });
  };

  const handleDuplicate = (t: CustomLayoutTemplate) => {
    const { templates } = persistDuplicate(t);
    dispatch({ type: 'SYNC_CUSTOM_LAYOUTS', templates });
    setDraft(templates[templates.length - 1] ?? null);
  };

  const handleRename = (id: string, name: string) => {
    const templates = persistRename(id, name);
    dispatch({ type: 'SYNC_CUSTOM_LAYOUTS', templates });
    setDraft((prev) => (prev && prev.id === id ? { ...prev, name } : prev));
  };

  const handleDelete = (id: string) => {
    const templates = persistDelete(id);
    dispatch({ type: 'SYNC_CUSTOM_LAYOUTS', templates });
    setDraft((prev) => (prev?.id === id ? null : prev));
    setNav({ view: 'file' });
  };

  const handleExportJson = (t: CustomLayoutTemplate) => {
    const json = exportLayoutJson(t);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t.name.replace(/[^a-z0-9_-]+/gi, '_')}.layout.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImportFile = async (file: File) => {
    try {
      const json = await file.text();
      const imported = importLayoutJson(json, file.name.replace(/\.json$/i, ''));
      dispatch({ type: 'SYNC_CUSTOM_LAYOUTS', templates: loadCustomLayouts() });
      setDraft(cloneTemplate(imported));
      setNav({ view: 'file' });
      toast.push({ kind: 'success', title: 'Layout imported', message: imported.name });
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Import failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  // ---- Canonical ordered selected files (§10 — one shared ordering) ----
  const orderedFiles = useMemo(() => {
    const out: Array<{ projectId: string; projectLabel: string; fileId: string; name: string; path: string }> = [];
    for (const project of state.projects) {
      const selected = getSelectedFiles(project.id);
      const ordered = effectiveFileOrder(project.files, state.fileOrder[project.id]);
      for (const f of ordered) {
        if (!selected.has(f.id)) continue;
        out.push({
          projectId: project.id,
          projectLabel: project.label,
          fileId: f.id,
          name: f.relativePath.split('/').pop() ?? f.relativePath,
          path: f.relativePath,
        });
      }
    }
    return out;
  }, [state.projects, state.fileOrder, getSelectedFiles]);

  // ---- Live resolution (§17 — one canonical pipeline) ----
  const layoutProjects = useMemo(
    () =>
      state.projects.map((p) => ({
        id: p.id,
        label: p.label,
        folderName: p.folderName,
        structurePaths: [],
        files: p.files
          .filter((f) => !f.excluded && getSelectedFiles(p.id).has(f.id))
          .map((f) => ({
            projectId: p.id,
            projectLabel: p.label,
            relativePath: f.relativePath,
            language: f.language,
            highlighted: {
              fileId: f.id,
              relativePath: f.relativePath,
              language: f.language,
              lines: [],
            },
            sizeBytes: f.size,
          })),
      })),
    [state.projects, getSelectedFiles],
  );

  const resolution = useMemo(() => {
    if (!draft) return null;
    const inputs: ResolutionInputs = {
      projects: layoutProjects,
      fileDetails: state.fileDetails,
      fileFieldValues: state.fileFieldValues,
      sectionFieldValues: state.sectionFieldValues,
      fileOrder: state.fileOrder,
      assignments: state.layoutAssignments,
      imageAssets: Object.fromEntries(state.imageAssets.map((a) => [a.id, a])),
      metadata: state.metadata,
      fileCount: layoutProjects.reduce((acc, p) => acc + p.files.length, 0),
    };
    return resolveCustomLayout(draft, inputs);
  }, [
    draft,
    layoutProjects,
    state.fileDetails,
    state.fileFieldValues,
    state.sectionFieldValues,
    state.fileOrder,
    state.layoutAssignments,
    state.imageAssets,
    state.metadata,
  ]);

  const validationIssues = useMemo(() => {
    if (!draft) return { missing: [] as ReturnType<typeof validateCustomLayout>, unassigned: [] as string[] };
    const missing = validateCustomLayout({
      template: draft,
      projects: layoutProjects,
      fileDetails: state.fileDetails,
      fileFieldValues: state.fileFieldValues,
      sectionFieldValues: state.sectionFieldValues,
      fileAssignments: state.layoutAssignments,
    });
    const unassigned = unassignedFileIds({
      template: draft,
      projects: layoutProjects,
      fileDetails: state.fileDetails,
      fileFieldValues: state.fileFieldValues,
      sectionFieldValues: state.sectionFieldValues,
      fileAssignments: state.layoutAssignments,
    });
    return { missing, unassigned };
  }, [draft, layoutProjects, state.fileDetails, state.fileFieldValues, state.sectionFieldValues, state.layoutAssignments]);

  /** Lazy plain-text load for the studio preview's code placeholders. */
  function loadFileText(fileId: string): string | null {
    for (const project of state.projects) {
      const file = project.files.find((f) => f.id === fileId);
      if (file?.fileHandle) {
        void file.fileHandle
          .getText()
          .then((text) => {
            fileTextCache.current.set(fileId, text);
            setFileTextTick((n) => n + 1);
          })
          .catch(() => {
            fileTextCache.current.set(fileId, '// unreadable file');
            setFileTextTick((n) => n + 1);
          });
        return null;
      }
    }
    return null;
  }

  const activeSection =
    draft && nav.view !== 'file'
      ? draft.sections.find((s) => s.id === nav.sectionId) ?? null
      : null;
  const activeBlock =
    draft && nav.view === 'block'
      ? activeSection?.children.find(
          (c): c is Extract<SectionChild, { kind: 'block' }> =>
            c.kind === 'block' && c.block.id === nav.blockId,
        )?.block ?? null
      : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="panel relative flex h-full max-h-[94vh] w-full max-w-[1560px] flex-col overflow-hidden shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Custom layout studio"
      >
        {/* Header + breadcrumb */}
        <div className="flex items-center gap-2 border-b border-app px-4 py-2.5">
          <Layers size={15} className="text-secondary" />
          <h2 className="text-sm font-semibold text-primary">Layout studio</h2>
          {draft && state.appliedLayoutId === draft.id && (
            <span className="badge" data-applied="true">
              applied
            </span>
          )}
          {/* Breadcrumb — the 3-level hierarchy is always visible (§0) */}
          <nav className="ml-2 flex min-w-0 items-center gap-1 text-xs text-muted" aria-label="Layout editor levels">
            <button
              type="button"
              className={`rounded px-1.5 py-0.5 transition-colors hover:text-primary ${nav.view === 'file' ? 'bg-app font-medium text-primary' : ''}`}
              onClick={() => setNav({ view: 'file' })}
            >
              File layout
            </button>
            {activeSection && (
              <>
                <span aria-hidden="true">/</span>
                <button
                  type="button"
                  className={`max-w-[160px] truncate rounded px-1.5 py-0.5 transition-colors hover:text-primary ${nav.view === 'section' ? 'bg-app font-medium text-primary' : ''}`}
                  onClick={() => setNav({ view: 'section', sectionId: activeSection.id })}
                >
                  {activeSection.name}
                </button>
              </>
            )}
            {activeBlock && activeSection && (
              <>
                <span aria-hidden="true">/</span>
                <span className="max-w-[160px] truncate rounded bg-app px-1.5 py-0.5 font-medium text-primary">
                  {activeBlock.name}
                </span>
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              className="btn-ghost"
              onClick={reopenTour}
              title="Layout onboarding — what File / Section / Block / Field mean"
              aria-label="Reopen layout onboarding"
              data-tour="layout-help"
            >
              <HelpCircle size={14} />
            </button>
            {state.appliedLayoutId && (
              <button className="btn-ghost" onClick={handleUnapply} title="Stop using a custom layout">
                Unapply
              </button>
            )}
            <button className="btn-secondary" onClick={handleApply} disabled={!draft} title="Use this layout for preview + exports">
              <Play size={13} />
              Apply
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={!draft}>
              <Save size={13} />
              Save
            </button>
            <button className="btn-ghost" onClick={onClose} aria-label="Close studio">
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* LEFT — templates (§30) */}
          <aside className="hidden w-52 flex-shrink-0 flex-col overflow-y-auto border-r border-app bg-app/40 p-2 md:flex">
            <button className="btn-secondary mb-1.5 w-full justify-center" onClick={handleNew}>
              <Plus size={13} /> New template
            </button>
            <button className="btn-secondary mb-2 w-full justify-center" onClick={handleExample} title="Load a working example layout">
              <FileText size={13} /> Load example
            </button>
            <div className="space-y-1">
              {state.customLayouts.map((t) => (
                <div
                  key={t.id}
                  className={`group rounded-md border px-2 py-1.5 text-xs transition-colors ${
                    draft?.id === t.id
                      ? 'border-[var(--color-accent)] bg-app'
                      : 'border-transparent hover:border-app'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-primary"
                      title={`${t.name} — open for editing`}
                      onClick={() => {
                        setDraft(cloneTemplate(t));
                        setNav({ view: 'file' });
                      }}
                    >
                      {t.name}
                    </button>
                    {state.appliedLayoutId === t.id && (
                      <span className="text-[9px] font-bold uppercase text-[var(--color-accent)]">
                        live
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-muted">
                    <span className="truncate">
                      {t.sections.length} section{t.sections.length === 1 ? '' : 's'}
                    </span>
                    <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <button
                        type="button"
                        className="rounded p-0.5 hover:text-primary"
                        title={`Rename ${t.name}`}
                        aria-label={`Rename ${t.name}`}
                        onClick={() => {
                          const name = prompt('Template name', t.name);
                          if (name?.trim()) handleRename(t.id, name.trim());
                        }}
                      >
                        <Save size={10} />
                      </button>
                      <button
                        type="button"
                        className="rounded p-0.5 hover:text-primary"
                        title={`Duplicate ${t.name}`}
                        aria-label={`Duplicate ${t.name}`}
                        onClick={() => handleDuplicate(t)}
                      >
                        <Copy size={10} />
                      </button>
                      <button
                        type="button"
                        className="rounded p-0.5 hover:text-primary"
                        title={`Export ${t.name} as JSON`}
                        aria-label={`Export ${t.name} as JSON`}
                        onClick={() => handleExportJson(t)}
                      >
                        <Download size={10} />
                      </button>
                      <button
                        type="button"
                        className="rounded p-0.5 hover:text-error"
                        title={`Delete ${t.name}`}
                        aria-label={`Delete ${t.name}`}
                        onClick={() => handleDelete(t.id)}
                      >
                        <Trash size={10} />
                      </button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-2 flex items-center gap-1.5 rounded-md border border-dashed border-app px-2 py-1.5 text-xs text-muted transition-colors hover:text-primary"
              onClick={() => importInputRef.current?.click()}
            >
              <Upload size={11} /> Import JSON
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label="Import layout JSON"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportFile(f);
                e.target.value = '';
              }}
            />
            <p className="mt-3 px-1 text-[10px] leading-relaxed text-muted">
              Layouts define WHAT appears and where. Fonts, colors and page setup
              still come from the style preset (Template editor).
            </p>
          </aside>

          {/* CENTER — editor */}
          <section className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            {!draft ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm text-muted">
                <Layers size={22} />
                <p>
                  Select or create a custom layout template to start composing.
                </p>
                <div className="flex gap-2">
                  <button className="btn-secondary" onClick={handleNew}>
                    <Plus size={13} /> New template
                  </button>
                  <button className="btn-secondary" onClick={handleExample}>
                    <FileText size={13} /> Load example
                  </button>
                </div>
              </div>
            ) : nav.view === 'file' ? (
              <FileLayoutEditor
                draft={draft}
                setDraft={setDraft}
                onEditSection={(sectionId) => setNav({ view: 'section', sectionId })}
                onFillContent={(s) =>
                  setContentDialog({ sectionId: s.id, sectionName: s.name, fields: s.fields })
                }
                orderedFiles={orderedFiles}
                validationUnassigned={validationIssues.unassigned}
              />
            ) : nav.view === 'section' && activeSection ? (
              <SectionEditor
                draft={draft}
                setDraft={setDraft}
                section={activeSection}
                orderedFiles={orderedFiles}
                onFillContent={() =>
                  setContentDialog({
                    sectionId: activeSection.id,
                    sectionName: activeSection.name,
                    fields: activeSection.fields,
                  })
                }
                onEditBlock={(blockId) =>
                  setNav({ view: 'block', sectionId: activeSection.id, blockId })
                }
              />
            ) : nav.view === 'block' && activeSection && activeBlock ? (
              <BlockEditor
                draft={draft}
                section={activeSection}
                block={activeBlock}
                orderedFiles={orderedFiles}
                collapsed={collapsed}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                onToggleCollapse={toggleCollapse}
                update={update}
              />
            ) : (
              <div className="p-6 text-sm text-muted">This section no longer exists.</div>
            )}

            {/* Validation summary (§5) — visible in every level */}
            {(validationIssues.missing.length > 0 || validationIssues.unassigned.length > 0) && (
              <div
                className="mx-3 mb-3 rounded-md border p-2 text-xs"
                style={{
                  borderColor: 'color-mix(in srgb, var(--color-warning) 40%, transparent)',
                  background: 'color-mix(in srgb, var(--color-warning) 8%, transparent)',
                }}
              >
                {validationIssues.missing.length > 0 && (
                  <>
                    <div className="font-semibold text-warning">
                      Export would be blocked — required fields missing
                    </div>
                    <ul className="mt-1 list-inside list-disc text-secondary">
                      {validationIssues.missing.slice(0, 4).map((m, i) => (
                        <li key={i}>
                          {m.instance}
                          {m.blockName ? ` (block: ${m.blockName})` : ''}: {m.fields.join(', ')}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {validationIssues.unassigned.length > 0 && (
                  <div className={validationIssues.missing.length > 0 ? 'mt-1 text-secondary' : 'font-semibold text-warning'}>
                    {validationIssues.unassigned.length} selected file
                    {validationIssues.unassigned.length === 1 ? ' is' : 's are'} not assigned
                    to any block — they will not appear in this layout&apos;s export
                    (assign them in the File layout editor).
                  </div>
                )}
              </div>
            )}
          </section>

          {/* RIGHT — live preview (§17) */}
          <aside className="hidden w-[26rem] flex-shrink-0 flex-col border-l border-app bg-app/40 xl:flex" data-tour="layout-preview">
            <div className="border-b border-app px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-secondary">
              Live preview — resolved with your data
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {resolution && resolution.blocks.length > 0 ? (
                <ResolvedPreview
                  blocks={resolution.blocks}
                  filesById={fileTextCache}
                  onNeedFileText={loadFileText}
                  projects={layoutProjects}
                />
              ) : (
                <p className="px-2 py-6 text-center text-xs text-muted">
                  {draft
                    ? 'The resolved document is empty for the current data — assign files to blocks, or add content nodes.'
                    : 'No template selected.'}
                </p>
              )}
            </div>
          </aside>
        </div>

        {/* Onboarding overlay (anchored inside the studio) */}
        <LayoutOnboarding key={tourKey} open={tourOpen} onFinish={finishTour} />
      </div>

      {contentDialog && (
        <SectionContentDialog
          sectionId={contentDialog.sectionId}
          sectionName={contentDialog.sectionName}
          fields={contentDialog.fields}
          onClose={() => setContentDialog(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LEVEL 1 — File Layout editor (§1)                                   */
/* ------------------------------------------------------------------ */

function FileLayoutEditor({
  draft,
  setDraft,
  onEditSection,
  onFillContent,
  orderedFiles,
}: {
  draft: CustomLayoutTemplate;
  setDraft: (t: CustomLayoutTemplate) => void;
  onEditSection: (sectionId: string) => void;
  onFillContent: (section: CustomLayoutTemplate['sections'][number]) => void;
  orderedFiles: Array<{ projectId: string; projectLabel: string; fileId: string; name: string; path: string }>;
  validationUnassigned: string[];
}) {
  const { state, dispatch } = useAppState();
  const [newType, setNewType] = useState<SectionTypeId>('task');

  const assignedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const section of draft.sections) {
      for (const child of section.children) {
        if (child.kind === 'block') {
          for (const id of state.layoutAssignments[child.block.id] ?? []) ids.add(id);
        }
      }
    }
    return ids;
  }, [draft, state.layoutAssignments]);

  const unassigned = orderedFiles.filter((f) => !assignedIds.has(f.fileId));

  const moveSection = (sectionId: string, delta: number) => {
    const idx = draft.sections.findIndex((s) => s.id === sectionId);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= draft.sections.length) return;
    const next = cloneTemplate(draft);
    const [moved] = next.sections.splice(idx, 1);
    next.sections.splice(to, 0, moved);
    next.updatedAt = Date.now();
    setDraft(next);
  };

  const filesInSection = (section: CustomLayoutTemplate['sections'][number]): number => {
    let count = 0;
    for (const child of section.children) {
      if (child.kind === 'block') {
        count += (state.layoutAssignments[child.block.id] ?? []).length;
      }
    }
    return count;
  };

  return (
    <div className="space-y-3 p-3" data-tour="layout-sections">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <label className="label block mb-1">Template name</label>
          <input
            type="text"
            className="input"
            value={draft.name}
            onChange={(e) => {
              const next = cloneTemplate(draft);
              next.name = e.target.value;
              next.updatedAt = Date.now();
              setDraft(next);
            }}
          />
        </div>
        <div className="text-[11px] text-muted">
          {draft.sections.length} section{draft.sections.length === 1 ? '' : 's'} · the document renders sections top to bottom
        </div>
      </div>

      {draft.sections.length === 0 ? (
        <p className="rounded-md border border-dashed border-app px-3 py-6 text-center text-xs text-muted">
          No sections yet — add one below. Sections are the top level of your document.
        </p>
      ) : (
        <ol className="space-y-1.5" aria-label="Document sections">
          {draft.sections.map((section, i) => (
            <li
              key={section.id}
              className="rounded-md border border-app bg-surface/60 p-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="codice-drag-handle text-muted" aria-hidden="true">
                  <ChevronRight size={12} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-primary">
                    {i + 1}. {section.name}
                  </span>
                  <span className="text-[10px] text-muted">
                    {SECTION_TYPE_PRESETS[section.type].label} · {filesInSection(section)} file
                    {filesInSection(section) === 1 ? '' : 's'} · {section.fields.length} field
                    {section.fields.length === 1 ? '' : 's'}
                  </span>
                </span>
                <label className="flex items-center gap-1 text-[10px] text-secondary" title="Start this section on a fresh page">
                  <input
                    type="checkbox"
                    className="h-3 w-3"
                    checked={section.pageBreakBefore}
                    onChange={(e) => {
                      const next = cloneTemplate(draft);
                      const s = next.sections.find((x) => x.id === section.id);
                      if (s) {
                        s.pageBreakBefore = e.target.checked;
                        next.updatedAt = Date.now();
                        setDraft(next);
                      }
                    }}
                  />
                  page break
                </label>
                <button type="button" className="codice-bulk-btn" onClick={() => onFillContent(section)} title="Fill this section's field values">
                  Content
                </button>
                <button type="button" className="btn-secondary !px-2 !py-1 text-[11px]" onClick={() => onEditSection(section.id)}>
                  Edit section
                </button>
                <span className="flex items-center gap-0.5">
                  <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Move section earlier" aria-label={`Move ${section.name} earlier`} onClick={() => moveSection(section.id, -1)}>
                    <ChevronUp size={11} />
                  </button>
                  <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Move section later" aria-label={`Move ${section.name} later`} onClick={() => moveSection(section.id, 1)}>
                    <ChevronDown size={11} />
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted hover:text-error"
                    title={`Delete ${section.name}`}
                    aria-label={`Delete ${section.name}`}
                    onClick={() => {
                      const next = cloneTemplate(draft);
                      next.sections = next.sections.filter((s) => s.id !== section.id);
                      next.updatedAt = Date.now();
                      setDraft(next);
                    }}
                  >
                    <Trash size={11} />
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* Add section */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-app p-2">
        <Plus size={13} className="text-muted" />
        <select
          className="select w-56"
          value={newType}
          onChange={(e) => setNewType(e.target.value as SectionTypeId)}
          aria-label="New section type"
        >
          {Object.values(SECTION_TYPE_PRESETS).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
          {SECTION_TYPE_PRESETS[newType].description}
        </span>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            const next = cloneTemplate(draft);
            next.sections.push(createSection(newType));
            next.updatedAt = Date.now();
            setDraft(next);
          }}
        >
          Add section
        </button>
      </div>

      {/* Unassigned files tray (§3 — every file lands somewhere, visibly) */}
      <div className="rounded-md border border-app p-2">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
            Files not in any section
          </span>
          <span className="text-[10px] text-muted">
            {unassigned.length} of {orderedFiles.length} selected file{orderedFiles.length === 1 ? '' : 's'}
          </span>
        </div>
        {unassigned.length === 0 ? (
          <p className="px-1 py-2 text-center text-[11px] text-muted">
            Every selected file is assigned — files render exactly once, in their block.
          </p>
        ) : (
          <ul className="max-h-44 space-y-1 overflow-y-auto">
            {unassigned.map((f) => (
              <li key={f.fileId} className="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-app">
                <span className="min-w-0 flex-1 truncate text-secondary" title={`${f.path} (${f.projectLabel})`}>
                  {f.path}
                </span>
                <span className="text-[10px] text-muted">{f.projectLabel}</span>
                <select
                  className="select w-44 py-0.5 text-[11px]"
                  value=""
                  aria-label={`Assign ${f.path} to a block`}
                  onChange={(e) => {
                    const blockId = e.target.value;
                    if (!blockId) return;
                    dispatch({ type: 'ASSIGN_FILE_TO_BLOCK', blockId, fileId: f.fileId });
                  }}
                >
                  <option value="">Assign to…</option>
                  {draft.sections.flatMap((s) =>
                    s.children
                      .filter((c): c is Extract<SectionChild, { kind: 'block' }> => c.kind === 'block')
                      .map((c) => (
                        <option key={c.block.id} value={c.block.id}>
                          {s.name} → {c.block.name}
                        </option>
                      )),
                  )}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LEVEL 2 — Section editor (§2)                                       */
/* ------------------------------------------------------------------ */

function SectionEditor({
  draft,
  setDraft,
  section,
  orderedFiles,
  onFillContent,
  onEditBlock,
}: {
  draft: CustomLayoutTemplate;
  setDraft: (t: CustomLayoutTemplate) => void;
  section: CustomLayoutTemplate['sections'][number];
  orderedFiles: Array<{ projectId: string; projectLabel: string; fileId: string; name: string; path: string }>;
  onFillContent: () => void;
  onEditBlock: (blockId: string) => void;
}) {
  const { state, dispatch } = useAppState();
  const toast = useToast();

  const mutate = (fn: (t: CustomLayoutTemplate, s: CustomLayoutTemplate['sections'][number]) => void) => {
    const next = cloneTemplate(draft);
    const s = next.sections.find((x) => x.id === section.id);
    if (!s) return;
    fn(next, s);
    next.updatedAt = Date.now();
    setDraft(next);
  };

  const moveChild = (childId: string, delta: number) => {
    mutate((_t, s) => {
      const idx = s.children.findIndex((c) => c.id === childId);
      const to = idx + delta;
      if (idx < 0 || to < 0 || to >= s.children.length) return;
      const [moved] = s.children.splice(idx, 1);
      s.children.splice(to, 0, moved);
    });
  };

  const removeChild = (childId: string) => {
    const child = section.children.find((c) => c.id === childId);
    mutate((_t, s) => {
      s.children = s.children.filter((c) => c.id !== childId);
    });
    // Orphaned block assignments are cleared for hygiene (§3).
    if (child?.kind === 'block') {
      dispatch({ type: 'CLEAR_BLOCK_ASSIGNMENTS', blockId: child.block.id });
    }
  };

  const assignedInBlock = (blockId: string) => state.layoutAssignments[blockId] ?? [];
  const fileById = (id: string) => orderedFiles.find((f) => f.fileId === id);

  return (
    <div className="space-y-3 p-3">
      {/* Section identity */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px] flex-1">
          <label className="label block mb-1">Section name</label>
          <input
            type="text"
            className="input"
            value={section.name}
            onChange={(e) => mutate((_t, s) => { s.name = e.target.value; })}
          />
        </div>
        <div>
          <label className="label block mb-1">Type — seeds a starting structure</label>
          <select
            className="select w-60"
            value={section.type}
            onChange={(e) => {
              const type = e.target.value as SectionTypeId;
              mutate((_t, s) => {
                s.type = type;
                // §1 — the type populates an initial structure; customizing
                // afterwards is expected. Appending keeps user content.
                const built = SECTION_TYPE_PRESETS[type].build();
                s.fields.push(...built.fields);
                s.children.push(...built.children);
              });
              toast.push({
                kind: 'info',
                title: `Structure appended — ${SECTION_TYPE_PRESETS[type].label}`,
                message: 'The type preset added fields and content; customize freely.',
              });
            }}
          >
            {Object.values(SECTION_TYPE_PRESETS).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="codice-bulk-btn" onClick={onFillContent}>
          Fill content
        </button>
      </div>

      {/* Section fields (§4 — section scope) */}
      <FieldsEditorV2
        title="Section fields — shared by this section"
        hint="Section fields hold section-level content (Task Title, Output, Answer…). Values are filled once per section."
        fields={section.fields}
        onAdd={() =>
          mutate((_t, s) => {
            s.fields.push({ id: genLayoutId('fld'), label: `Field ${s.fields.length + 1}`, kind: 'text', required: false });
          })
        }
        onPatch={(id, patch) =>
          mutate((_t, s) => {
            const f = s.fields.find((x) => x.id === id);
            if (f) Object.assign(f, patch);
          })
        }
        onRemove={(id) => mutate((_t, s) => { s.fields = s.fields.filter((f) => f.id !== id); })}
      />

      {/* Children — standalone nodes + block refs, in order (§2) */}
      <div className="rounded-md border border-app p-2" data-tour="layout-children">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
            Section content — ordered
          </span>
          <span className="text-[10px] text-muted">standalone nodes and file blocks, top to bottom</span>
        </div>
        {section.children.length === 0 ? (
          <p className="px-1 py-3 text-center text-xs text-muted">
            Empty — add standalone content or a file block below.
          </p>
        ) : (
          <ol className="space-y-1" role="list" aria-label="Section children">
            {section.children.map((child, idx) => (
              <li key={child.id} className="rounded border border-app bg-surface/60 p-1.5">
                {child.kind === 'node' ? (
                  <div className="flex items-center gap-2">
                    <span className="codice-drag-handle text-muted" aria-hidden="true">
                      <ChevronRight size={11} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-secondary">
                      <span className="font-medium text-primary">{nodeLabel(child.node)}</span>
                      {child.node.text ? ` — “${child.node.text.slice(0, 40)}”` : ''}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <MoveButtons onUp={() => moveChild(child.id, -1)} onDown={() => moveChild(child.id, 1)} onRemove={() => removeChild(child.id)} label="node" />
                    </span>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="codice-drag-handle text-muted" aria-hidden="true">
                        <ChevronRight size={11} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs">
                        <span className="font-semibold text-primary">Block: {child.block.name}</span>
                        <span className="ml-1 text-muted">
                          — {assignedInBlock(child.block.id).length} file
                          {assignedInBlock(child.block.id).length === 1 ? '' : 's'} assigned · pattern repeats once per file
                        </span>
                      </span>
                      <button type="button" className="codice-bulk-btn" onClick={() => onEditBlock(child.block.id)}>
                        Edit block
                      </button>
                      <MoveButtons onUp={() => moveChild(child.id, -1)} onDown={() => moveChild(child.id, 1)} onRemove={() => removeChild(child.id)} label="block" />
                    </div>
                    {/* Assigned files (§3 — one instance per file) */}
                    {assignedInBlock(child.block.id).length > 0 && (
                      <div className="flex flex-wrap gap-1 pl-4">
                        {assignedInBlock(child.block.id).map((fid, i) => {
                          const f = fileById(fid);
                          return (
                            <span key={fid} className="flex items-center gap-1 rounded border border-app px-1.5 py-0.5 text-[10px] text-secondary">
                              <span className="text-muted tabular-nums">{i + 1}</span>
                              <span className="max-w-[160px] truncate">{f?.path ?? fid}</span>
                              <button
                                type="button"
                                className="text-muted hover:text-error"
                                title={`Unassign ${f?.path ?? 'file'}`}
                                aria-label={`Unassign ${f?.path ?? 'file'}`}
                                onClick={() => dispatch({ type: 'UNASSIGN_FILE', fileId: fid, blockId: child.block.id })}
                              >
                                <X size={9} />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}

        {/* Add controls */}
        <div className="mt-2 space-y-1.5 border-t border-app pt-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="w-24 flex-shrink-0 text-[10px] text-muted">Standalone</span>
            {(['heading', 'text', 'image', 'divider', 'spacer', 'pageBreak'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className="codice-input-chip"
                onClick={() =>
                  mutate((_t, s) => {
                    s.children.push({ kind: 'node', id: genLayoutId('ch'), node: makeNode(t) });
                  })
                }
              >
                <Plus size={9} /> {standaloneLabel(t)}
              </button>
            ))}
            {(['toc', 'metadata'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className="codice-input-chip"
                onClick={() =>
                  mutate((_t, s) => {
                    s.children.push({ kind: 'node', id: genLayoutId('ch'), node: makeNode(t) });
                  })
                }
              >
                <Plus size={9} /> {standaloneLabel(t)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="w-24 flex-shrink-0 text-[10px] text-muted">File block</span>
            {BLOCK_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="codice-input-chip"
                title={p.description}
                onClick={() =>
                  mutate((_t, s) => {
                    s.children.push({
                      kind: 'block',
                      id: genLayoutId('ch'),
                      block: createBlockDef(p.name, p.nodes),
                    });
                  })
                }
              >
                <Plus size={9} /> {p.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MoveButtons({
  onUp,
  onDown,
  onRemove,
  label,
}: {
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  label: string;
}) {
  return (
    <span className="flex items-center gap-0.5">
      <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title={`Move ${label} earlier`} aria-label={`Move ${label} earlier`} onClick={onUp}>
        <ChevronUp size={10} />
      </button>
      <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title={`Move ${label} later`} aria-label={`Move ${label} later`} onClick={onDown}>
        <ChevronDown size={10} />
      </button>
      <button type="button" className="rounded p-0.5 text-muted hover:text-error" title={`Remove ${label}`} aria-label={`Remove ${label}`} onClick={onRemove}>
        <Trash size={10} />
      </button>
    </span>
  );
}

function nodeLabel(node: TemplateNode): string {
  switch (node.type) {
    case 'text': return 'Text';
    case 'heading': return 'Heading';
    case 'image': return 'Image';
    case 'divider': return 'Divider';
    case 'spacer': return 'Spacer';
    case 'pageBreak': return 'Page break';
    case 'toc': return 'Table of contents';
    case 'metadata': return 'Metadata';
    case 'panel': return 'Panel';
    case 'columns': return 'Columns';
    default: return node.type;
  }
}

function standaloneLabel(t: 'heading' | 'text' | 'image' | 'divider' | 'spacer' | 'pageBreak' | 'toc' | 'metadata'): string {
  switch (t) {
    case 'heading': return 'Heading';
    case 'text': return 'Text';
    case 'image': return 'Image';
    case 'divider': return 'Divider';
    case 'spacer': return 'Spacer';
    case 'pageBreak': return 'Page break';
    case 'toc': return 'TOC';
    case 'metadata': return 'Metadata';
  }
}

/** Block presets (§0 — the Code-vs-File explanation lives in the tooltip). */
const BLOCK_PRESETS: Array<{ id: string; name: string; description: string; nodes: Array<Partial<TemplateNode>> }> = [
  {
    id: 'file',
    name: 'File (header + code)',
    description: 'The full file presentation: header (name, path, language, size) PLUS the syntax-highlighted code. Use this for the classic per-file section.',
    nodes: [{ type: 'file' }],
  },
  {
    id: 'code',
    name: 'Code only',
    description: 'ONLY the syntax-highlighted code of the file — no header. Use this when you want just the code.',
    nodes: [{ type: 'code' }],
  },
  {
    id: 'headingCode',
    name: 'Heading + Code',
    description: 'A heading with the file name, then the code.',
    nodes: [{ type: 'heading', text: '{fileName}', style: { level: 2 } }, { type: 'code' }],
  },
  {
    id: 'full',
    name: 'Heading + Details + Code',
    description: 'Heading, description, file header + code, note, and the file\'s attached images.',
    nodes: [
      { type: 'heading', text: '{fileName}', style: { level: 2 } },
      { type: 'description' },
      { type: 'file' },
      { type: 'note' },
      { type: 'fileImages' },
    ],
  },
  {
    id: 'empty',
    name: 'Custom (empty)',
    description: 'An empty block — compose the per-file pattern yourself in the Block editor.',
    nodes: [],
  },
];

/* ------------------------------------------------------------------ */
/* Fields editor (shared by section + block scopes)                    */
/* ------------------------------------------------------------------ */

function FieldsEditorV2({
  title,
  hint,
  fields,
  onAdd,
  onPatch,
  onRemove,
}: {
  title: string;
  hint: string;
  fields: TemplateFieldDefinition[];
  onAdd: () => void;
  onPatch: (id: string, patch: Partial<TemplateFieldDefinition>) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-app" data-tour="layout-fields">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs text-secondary transition-colors hover:text-primary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="font-medium">{title}</span>
        <span className="badge">{fields.length}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-app p-2">
          <p className="text-[10px] text-muted">{hint}</p>
          {fields.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-1.5 text-xs">
              <input
                type="text"
                className="input w-40 py-0.5"
                value={f.label}
                aria-label="Field label"
                onChange={(e) => onPatch(f.id, { label: e.target.value })}
              />
              <select
                className="select w-24 py-0.5"
                value={f.kind}
                aria-label="Field kind"
                onChange={(e) => onPatch(f.id, { kind: e.target.value as TemplateFieldDefinition['kind'] })}
              >
                <option value="text">Text</option>
                <option value="textarea">Paragraph</option>
                <option value="image">Image</option>
              </select>
              <label className="flex items-center gap-1 text-[11px] text-secondary">
                <input
                  type="checkbox"
                  className="h-3 w-3"
                  checked={f.required}
                  onChange={(e) => onPatch(f.id, { required: e.target.checked })}
                />
                Required
              </label>
              <button
                type="button"
                className="codice-bulk-btn ml-auto"
                title={`Remove field ${f.label}`}
                aria-label={`Remove field ${f.label}`}
                onClick={() => onRemove(f.id)}
              >
                <Trash size={10} />
              </button>
            </div>
          ))}
          <button type="button" className="codice-bulk-btn" onClick={onAdd}>
            <Plus size={10} /> Add field
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LEVEL 3 — Block editor (§3/§9 — the original Block Editor,          */
/* integrated into the hierarchy)                                      */
/* ------------------------------------------------------------------ */

function BlockEditor({
  draft,
  section,
  block,
  orderedFiles,
  collapsed,
  selectedNodeId,
  onSelectNode,
  onToggleCollapse,
  update,
}: {
  draft: CustomLayoutTemplate;
  section: CustomLayoutTemplate['sections'][number];
  block: Extract<SectionChild, { kind: 'block' }>['block'];
  orderedFiles: Array<{ projectId: string; projectLabel: string; fileId: string; name: string; path: string }>;
  collapsed: Set<string>;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  update: (fn: (t: CustomLayoutTemplate) => void) => void;
}) {
  const { state, dispatch } = useAppState();

  const mutateBlock = (fn: (b: Extract<SectionChild, { kind: 'block' }>['block']) => void) => {
    update((t) => {
      for (const s of t.sections) {
        for (const child of s.children) {
          if (child.kind === 'block' && child.block.id === block.id) fn(child.block);
        }
      }
    });
  };

  const nodes = block.nodes;
  const assigned = state.layoutAssignments[block.id] ?? [];

  const nodeOps = {
    onAdd: (type: TemplateNode['type'], containerId?: string | null, columnIdx?: number) => {
      const node = makeNode(type);
      mutateBlock((b) => {
        if (containerId) {
          const container = findContainer(b.nodes, containerId);
          if (container?.children) {
            const idx = columnIdx ?? 0;
            container.children[Math.min(idx, container.children.length - 1)]?.push(node);
          }
        } else {
          b.nodes.push(node);
        }
      });
      onSelectNode(node.id);
    },
    onMove: (id: string, delta: number) => {
      mutateBlock((b) => {
        const found = findNodeList(b.nodes, id);
        if (!found) return;
        const to = found.index + delta;
        if (to < 0 || to >= found.list.length) return;
        const [moved] = found.list.splice(found.index, 1);
        found.list.splice(to, 0, moved);
      });
    },
    onRemove: (id: string) => {
      mutateBlock((b) => {
        const found = findNodeList(b.nodes, id);
        if (found) found.list.splice(found.index, 1);
      });
    },
    onDuplicate: (id: string) => {
      mutateBlock((b) => {
        const found = findNodeList(b.nodes, id);
        if (!found) return;
        const copy = cloneTemplate(found.list[found.index]);
        copy.id = genLayoutId('n');
        found.list.splice(found.index + 1, 0, copy);
      });
    },
    onPatch: (id: string, patch: Partial<TemplateNode>) => {
      mutateBlock((b) => {
        const found = findNodeList(b.nodes, id);
        if (found) Object.assign(found.list[found.index], patch);
      });
    },
    onPatchStyle: (id: string, patch: Partial<NonNullable<TemplateNode['style']>>) => {
      mutateBlock((b) => {
        const found = findNodeList(b.nodes, id);
        if (found) {
          found.list[found.index].style = { ...(found.list[found.index].style ?? {}), ...patch };
        }
      });
    },
  };

  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <label className="label block mb-1">Block name</label>
          <input
            type="text"
            className="input"
            value={block.name}
            onChange={(e) => mutateBlock((b) => { b.name = e.target.value; })}
          />
        </div>
        <div className="text-[11px] text-muted">
          This pattern renders once per assigned file ({assigned.length} assigned)
        </div>
      </div>

      {/* Block fields (§4 — per-file scope) */}
      <FieldsEditorV2
        title="Block fields — filled per file"
        hint="Block fields hold per-file content (a screenshot per file, per-file notes…). Values are filled in File properties (right-click a file)."
        fields={block.fields}
        onAdd={() =>
          mutateBlock((b) => {
            b.fields.push({ id: genLayoutId('fld'), label: `Field ${b.fields.length + 1}`, kind: 'text', required: false });
          })
        }
        onPatch={(id, patch) =>
          mutateBlock((b) => {
            const f = b.fields.find((x) => x.id === id);
            if (f) Object.assign(f, patch);
          })
        }
        onRemove={(id) => mutateBlock((b) => { b.fields = b.fields.filter((f) => f.id !== id); })}
      />

      {/* Node tree (the original block editor capabilities, §9) */}
      <NodeTreeEditor
        nodes={nodes}
        fields={block.fields}
        sectionFields={section.fields}
        selectedId={selectedNodeId}
        collapsed={collapsed}
        onSelect={onSelectNode}
        onToggleCollapse={onToggleCollapse}
        {...nodeOps}
      />

      {/* File assignment (§3) */}
      <div className="rounded-md border border-app p-2">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
            Files assigned to this block
          </span>
          <span className="text-[10px] text-muted">
            one file → one section → one block instance (files are moved out of other blocks automatically)
          </span>
        </div>
        {assigned.length === 0 ? (
          <p className="px-1 py-2 text-center text-[11px] text-muted">
            No files assigned yet — pick files below.
          </p>
        ) : (
          <div className="mb-2 flex flex-wrap gap-1">
            {assigned.map((fid, i) => {
              const f = orderedFiles.find((x) => x.fileId === fid);
              return (
                <span key={fid} className="flex items-center gap-1 rounded border border-app px-1.5 py-0.5 text-[10px] text-secondary">
                  <span className="text-muted tabular-nums">{i + 1}</span>
                  <span className="max-w-[160px] truncate">{f?.path ?? fid}</span>
                  <button
                    type="button"
                    className="text-muted hover:text-error"
                    title={`Unassign ${f?.path ?? 'file'}`}
                    aria-label={`Unassign ${f?.path ?? 'file'}`}
                    onClick={() => dispatch({ type: 'UNASSIGN_FILE', fileId: fid, blockId: block.id })}
                  >
                    <X size={9} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <select
          className="select"
          value=""
          aria-label="Assign a file to this block"
          onChange={(e) => {
            const fileId = e.target.value;
            if (!fileId) return;
            dispatch({ type: 'ASSIGN_FILE_TO_BLOCK', blockId: block.id, fileId });
          }}
        >
          <option value="">+ Assign a file…</option>
          {orderedFiles.map((f) => (
            <option key={f.fileId} value={f.fileId}>
              {f.path} ({f.projectLabel})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
