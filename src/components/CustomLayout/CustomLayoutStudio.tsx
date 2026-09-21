'use client';

/**
 * Custom Layout Studio v3 (§0-§29).
 *
 * A visual document-template designer organized as the three-level
 * hierarchy the layout architecture defines:
 *
 *   File Layout   — ONE ordered container of standalone nodes + SECTIONS
 *                   (§2) + file assignment tray + page setup (§16/§17) +
 *                   export assignment (§25/§26)
 *   Section       — typed section editor: derived fields, standalone
 *                   content, block references, file assignment
 *   Block Editor  — the per-file pattern: nodes + derived block fields (§20)
 *
 * Everything edits a local DRAFT template; "Save" persists (storage.ts v3)
 * and "Apply" marks it as the active document layout. File → block
 * assignment lives in APP STATE (session-scoped — file ids die with
 * uploads) and is enforced one-file-one-section (§3).
 *
 * §27/§28 — when several export groups exist and "same layout for all"
 * is OFF, a tab row lets the user edit EACH export's own layout; the
 * saved template id is kept equal to the group's layoutId so exports use
 * exactly what was edited.
 *
 * Onboarding (§0): the tour opens automatically the first time the studio
 * opens and can always be reopened via the "?" button.
 */

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/components/common/Toast';
import {
  X,
  Plus,
  Minus,
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
  GripVertical,
  Layout as LayoutIcon,
} from '@/components/common/Icons';
import {
  SECTION_TYPE_PRESETS,
  appendSectionPreset,
  duplicateSection,
  cloneTemplate,
  createBlockDef,
  createEmptyTemplate,
  createExampleTemplate,
  createSection,
  assignedFileIds,
  duplicateBlockDef,
  genLayoutId,
  normalizeTemplate,
  sanitizeSectionType,
  sectionTypePreset,
  blockFieldsInContentOrder,
  NODE_TYPE_LABELS,
  type CustomLayoutTemplate,
  type RootChild,
  type SectionChild,
  type SectionTypeId,
  type TemplateFieldDefinition,
  type TemplateFieldType,
  type TemplateNode,
} from '@/lib/customLayouts/model';
import {
  documentFieldsInContentOrder,
  newFieldDefinition,
  rootNodeRoots,
  sectionNodeRoots,
  setNodeFieldBinding,
} from '@/lib/customLayouts/uiHelpers';
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
  NodeInspector,
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
import {
  SectionContentList,
  SectionFieldsPanel,
  BlockFieldsPanel,
  SectionTypeSeeder,
  ContentAddControls,
  InsertContentRow,
  FILE_LEVEL_TYPES,
  makeStandaloneChild,
  moveChild,
  removeChild,
  stripFieldBindings,
} from '@/components/CustomLayout/SectionContentEditor';
import { sectionFieldsInContentOrder, templateSections, type TemplateSection, type TemplateBlockType } from '@/lib/customLayouts/model';
import type {
  Alignment,
  DocumentPreset,
  FileHeaderStyle,
  FooterSlotType,
  MiscDocumentOptions,
  PageBreakBehavior,
  PageStyle,
  ProjectHeaderStyle,
  ProjectStructureStyle,
  TitlePageStyle,
  TocStyle,
  VerticalAlignment,
} from '@/lib/presets/documentPreset';
import type { ExportGroup } from '@/types';

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
  // normalizeTemplate guarantees the v2.1 invariants on every open: a
  // file-level children array (§7), content-synced section fields (§5/§6)
  // and stable node ids (§26).
  const [draft, setDraft] = useState<CustomLayoutTemplate | null>(() => {
    const applied = state.customLayouts.find((t) => t.id === state.appliedLayoutId);
    const base = applied ?? state.customLayouts[0] ?? null;
    return base ? normalizeTemplate(cloneTemplate(base)) : null;
  });
  const [nav, setNav] = useState<StudioView>({ view: 'file' });
  // §15 — the studio center column is organized into REAL top-level tabs:
  // "File Layout" (structure), "Page Settings" (page/page-advanced/header/
  // footer/title/TOC/page-break config) and "Assignment" (file→block +
  // export→project pools). Drilling into a section/block always lands back
  // on the structure tab.
  const [centerTab, setCenterTab] = useState<'structure' | 'page' | 'assignment'>('structure');
  const [collapsed, toggleCollapse] = useCollapseState();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contentDialog, setContentDialog] = useState<{
    sectionId?: string;
    sectionName: string;
    fields: TemplateFieldDefinition[];
    mode?: 'section' | 'document';
  } | null>(null);

  // ---- §27/§28 — per-export layout tabs ----
  // Tabs appear ONLY when several export groups exist AND "same layout for
  // all exports" is off. One group = no tabs; shared mode = no tabs.
  const [exportTab, setExportTab] = useState<'default' | string>('default');
  const showExportTabs = state.exportGroups.length > 1 && !state.sameLayoutForAllExports;
  const activeGroup = showExportTabs && exportTab !== 'default'
    ? state.exportGroups.find((g) => g.id === exportTab) ?? null
    : null;
  const activeGroupTemplate = activeGroup
    ? activeGroup.layoutId
      ? state.customLayouts.find((t) => t.id === activeGroup.layoutId) ?? null
      : null
    : null;

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
    setDraft(normalizeTemplate(t));
    setNav({ view: 'file' });
    toast.push({ kind: 'info', title: 'Template created', message: `${t.name} — add sections and assign files.` });
  };

  const handleExample = () => {
    const t = createExampleTemplate();
    setDraft(normalizeTemplate(t));
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
    // §27 — keep the active export tab bound to EXACTLY what was just saved,
    // so the export uses the template the user edited under that tab.
    if (activeGroup && activeGroup.layoutId !== draft.id) {
      dispatch({ type: 'UPDATE_EXPORT_GROUP', group: { ...activeGroup, layoutId: draft.id } });
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

  /** §27 — selecting a group tab switches WHICH template the studio edits. */
  const selectExportTab = (tab: 'default' | string) => {
    setExportTab(tab);
    setNav({ view: 'file' });
    setSelectedNodeId(null);
    if (tab === 'default') {
      const applied = state.customLayouts.find((t) => t.id === state.appliedLayoutId);
      const base = applied ?? state.customLayouts[0] ?? null;
      setDraft(base ? normalizeTemplate(cloneTemplate(base)) : null);
      return;
    }
    const group = state.exportGroups.find((g) => g.id === tab);
    if (!group) return;
    const template = group.layoutId
      ? state.customLayouts.find((t) => t.id === group.layoutId)
      : undefined;
    if (template) setDraft(normalizeTemplate(cloneTemplate(template)));
    // No layout yet → keep the current draft untouched; the editor area
    // shows the "choose/create a layout for this export" picker instead.
  };

  /** §27 — choosing/creating the layout for the active export group. */
  const bindGroupLayout = (group: ExportGroup, layoutId: string | null) => {
    dispatch({ type: 'UPDATE_EXPORT_GROUP', group: { ...group, layoutId } });
    const template = layoutId ? state.customLayouts.find((t) => t.id === layoutId) : null;
    if (template) {
      setDraft(normalizeTemplate(cloneTemplate(template)));
      setNav({ view: 'file' });
    }
  };

  /** §27 — create a fresh layout owned by this export group. */
  const createGroupLayout = (group: ExportGroup) => {
    const t = createEmptyTemplate(`${group.name} — layout`);
    dispatch({ type: 'SAVE_CUSTOM_LAYOUT', template: cloneTemplate(t) });
    dispatch({ type: 'UPDATE_EXPORT_GROUP', group: { ...group, layoutId: t.id } });
    setDraft(normalizeTemplate(t));
    setNav({ view: 'file' });
    toast.push({
      kind: 'info',
      title: 'Layout created',
      message: `“${t.name}” is now the layout of export “${group.name}”.`,
    });
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
      documentFieldValues: state.documentFieldValues,
      fileOrder: state.fileOrder,
      assignments: state.layoutAssignments,
      imageAssets: Object.fromEntries(state.imageAssets.map((a) => [a.id, a])),
      metadata: state.metadata,
      fileCount: layoutProjects.reduce((acc, p) => acc + p.files.length, 0),
      panelText: state.preset.colors.panelText,
    };
    return resolveCustomLayout(draft, inputs);
  }, [
    draft,
    layoutProjects,
    state.fileDetails,
    state.fileFieldValues,
    state.sectionFieldValues,
    state.documentFieldValues,
    state.fileOrder,
    state.layoutAssignments,
    state.imageAssets,
    state.metadata,
    state.preset,
  ]);

  const validationIssues = useMemo(() => {
    if (!draft) return { missing: [] as ReturnType<typeof validateCustomLayout>, unassigned: [] as string[] };
    const missing = validateCustomLayout({
      template: draft,
      projects: layoutProjects,
      fileDetails: state.fileDetails,
      fileFieldValues: state.fileFieldValues,
      sectionFieldValues: state.sectionFieldValues,
      documentFieldValues: state.documentFieldValues,
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
  }, [draft, layoutProjects, state.fileDetails, state.fileFieldValues, state.sectionFieldValues, state.documentFieldValues, state.layoutAssignments]);

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
      ? templateSections(draft).find((s) => s.id === nav.sectionId) ?? null
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
            {/* §27 — "Use same layout for all exports": on = one shared layout,
                off = each export gets its own layout tab below. */}
            <label
              className="flex items-center gap-1.5 text-[11px] text-secondary"
              title="When on, every export uses the globally applied layout. Turn off to give each export its own layout (tabs appear below)."
            >
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={state.sameLayoutForAllExports}
                onChange={(e) => {
                  dispatch({ type: 'SET_SAME_LAYOUT_FOR_ALL', value: e.target.checked });
                  if (e.target.checked) setExportTab('default');
                }}
              />
              Same layout for all exports
            </label>
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

        {/* §27/§28 — per-export layout tabs. Rendered ONLY when several export
            groups exist and "same layout for all exports" is off: one export
            → no tabs; shared mode → no duplicated tabs. */}
        {showExportTabs && (
          <div
            className="flex items-center gap-1 overflow-x-auto border-b border-app px-3 py-1.5"
            role="tablist"
            aria-label="Per-export layouts"
            data-tour="layout-export-tabs"
          >
            <button
              type="button"
              role="tab"
              aria-selected={exportTab === 'default'}
              className={`flex-shrink-0 rounded px-2 py-0.5 text-[11px] transition-colors ${
                exportTab === 'default'
                  ? 'bg-app font-semibold text-primary ring-1 ring-[var(--color-accent)]'
                  : 'text-secondary hover:text-primary'
              }`
              }
              title="The globally applied layout — used by exports without a specific layout"
              onClick={() => selectExportTab('default')}
            >
              Default layout
              {state.appliedLayoutId ? '' : ' (none applied)'}
            </button>
            {state.exportGroups.map((g) => (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={exportTab === g.id}
                className={`max-w-[180px] flex-shrink-0 truncate rounded px-2 py-0.5 text-[11px] transition-colors ${
                  exportTab === g.id
                    ? 'bg-app font-semibold text-primary ring-1 ring-[var(--color-accent)]'
                    : 'text-secondary hover:text-primary'
                }`}
                title={`Edit the layout used by export “${g.name}”`}
                onClick={() => selectExportTab(g.id)}
              >
                {g.name}
                {g.layoutId && state.customLayouts.some((t) => t.id === g.layoutId) ? '' : ' — pick layout'}
              </button>
            ))}
            <span className="ml-auto flex-shrink-0 pl-2 text-[10px] text-muted">
              Each export uses its own layout (§27) — manage exports in the Assignment tab
            </span>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* LEFT — templates (§30) */}
          <aside
            className="hidden w-52 flex-shrink-0 flex-col overflow-y-auto border-r border-app bg-app/40 p-2 md:flex"
            data-tour="layout-templates"
          >
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
                        setDraft(normalizeTemplate(cloneTemplate(t)));
                        setNav({ view: 'file' });
                        // §27 — picking a template while an export tab is open
                        // rebinds that export to the picked layout.
                        if (activeGroup && activeGroup.layoutId !== t.id) {
                          dispatch({ type: 'UPDATE_EXPORT_GROUP', group: { ...activeGroup, layoutId: t.id } });
                        }
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
                      {templateSections(t).length} section{templateSections(t).length === 1 ? '' : 's'}
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
              Layouts define WHAT appears and where. Page setup lives here; fonts, colors and
              density come from the style preset (Template editor).
            </p>
          </aside>

          {/* CENTER — editor */}
          <section className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            {draft && nav.view === 'file' && (
              /* §15 — top-level tabs: real tabs (role=tablist), not an
                 accordion. Page Settings and Assignment have dedicated homes. */
              <div
                className="flex flex-shrink-0 items-center gap-1 border-b border-app px-3 py-1.5"
                role="tablist"
                aria-label="Layout settings sections"
                data-tour="layout-tabs"
              >
                {([
                  ['structure', 'File Layout', 'Document structure — standalone nodes, sections and blocks', String(draft.rootChildren.length)],
                  ['page', 'Page Settings', 'Page size, margins, headers/footers, title page, TOC and page breaks', ''],
                  ['assignment', 'Assignment', 'Assign files to blocks and projects to exports', String(validationIssues.unassigned.length)],
                ] as const).map(([id, label, title, badge]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={centerTab === id}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      centerTab === id
                        ? 'bg-app text-primary ring-1 ring-[var(--color-accent)]'
                        : 'text-secondary hover:text-primary'
                    }`}
                    title={title}
                    onClick={() => setCenterTab(id)}
                  >
                    {label}
                    {badge !== '' && (
                      <span
                        className="codice-tab-badge"
                        title={
                          id === 'structure'
                            ? `${templateSections(draft).length} sections + ${draft.rootChildren.length - templateSections(draft).length} standalone`
                            : `${badge} unassigned`
                        }
                      >
                        {badge}
                      </span>
                    )}
                  </button>
                ))}
                <span className="ml-auto hidden text-[10px] text-muted lg:inline">
                  Structure → page → assignment: configure in this order
                </span>
              </div>
            )}
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
            ) : activeGroup && !activeGroupTemplate ? (
              /* §27 — the export tab has no layout yet: choose or create one. */
              <ExportLayoutPicker
                group={activeGroup}
                onPick={(layoutId) => bindGroupLayout(activeGroup, layoutId)}
                onCreate={() => createGroupLayout(activeGroup)}
              />
            ) : nav.view === 'file' ? (
              <FileLayoutEditor
                draft={draft}
                setDraft={setDraft}
                tab={centerTab}
                onEditSection={(sectionId) => setNav({ view: 'section', sectionId })}
                onFillContent={(s) =>
                  setContentDialog({
                    sectionId: s.id,
                    sectionName: s.name,
                    fields: sectionFieldsInContentOrder(s),
                  })
                }
                onFillDocumentContent={() =>
                  setContentDialog({
                    sectionName: 'Document fields',
                    fields: documentFieldsInContentOrder(draft),
                    mode: 'document',
                  })
                }
                orderedFiles={orderedFiles}
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
                    fields: sectionFieldsInContentOrder(activeSection),
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
          mode={contentDialog.mode ?? 'section'}
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
  tab,
  onEditSection,
  onFillContent,
  onFillDocumentContent,
  orderedFiles,
}: {
  draft: CustomLayoutTemplate;
  setDraft: (t: CustomLayoutTemplate) => void;
  /** §15 — which top-level studio tab is active (structure/page/assignment). */
  tab: 'structure' | 'page' | 'assignment';
  onEditSection: (sectionId: string) => void;
  onFillContent: (section: TemplateSection) => void;
  /** Opens the document-fields fill dialog (§21 values live in app state). */
  onFillDocumentContent: () => void;
  orderedFiles: Array<{ projectId: string; projectLabel: string; fileId: string; name: string; path: string }>;
}) {
  const { state, dispatch } = useAppState();
  const toast = useToast();
  const [newType, setNewType] = useState<SectionTypeId>('task');
  // §21 — file-level standalone nodes get the same inspector as every other
  // node, with DOCUMENT fields as bind targets.
  const [selectedRootNodeId, setSelectedRootNodeId] = useState<string | null>(null);
  const [docFieldsOpen, setDocFieldsOpen] = useState(false);

  const sections = templateSections(draft);
  const rootNodes = draft.rootChildren.filter(
    (c): c is Extract<RootChild, { kind: 'node' }> => c.kind === 'node',
  );
  // LIVE derived document fields (§20/§21 — content is the source of truth).
  const documentFields = documentFieldsInContentOrder(draft);

  const assignedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const section of sections) {
      for (const child of section.children) {
        if (child.kind === 'block') {
          for (const id of state.layoutAssignments[child.block.id] ?? []) ids.add(id);
        }
      }
    }
    return ids;
  }, [draft, state.layoutAssignments]);

  const unassigned = orderedFiles.filter((f) => !assignedIds.has(f.fileId));

  // ---- root mutations (§2 — ONE ordered container) ----
  const mutateRoot = (fn: (t: CustomLayoutTemplate) => void) => {
    const next = cloneTemplate(draft);
    fn(next);
    next.updatedAt = Date.now();
    setDraft(next);
  };

  const rootIndexOf = (key: string) =>
    draft.rootChildren.findIndex((c) => (c.kind === 'node' ? c.node.id : c.section.id) === key);

  const moveRootChild = (key: string, delta: number) => {
    const idx = rootIndexOf(key);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= draft.rootChildren.length) return;
    mutateRoot((t) => {
      const [moved] = t.rootChildren.splice(idx, 1);
      t.rootChildren.splice(to, 0, moved);
    });
  };

  const removeRootChild = (key: string) => {
    const idx = rootIndexOf(key);
    if (idx < 0) return;
    mutateRoot((t) => {
      t.rootChildren.splice(idx, 1);
    });
  };

  const duplicateRootChild = (key: string) => {
    const idx = rootIndexOf(key);
    if (idx < 0) return;
    mutateRoot((t) => {
      const src = t.rootChildren[idx];
      if (src.kind === 'section') {
        t.rootChildren.splice(idx + 1, 0, { kind: 'section', section: duplicateSection(src.section) });
      } else {
        const copy = cloneTemplate(src.node);
        copy.id = genLayoutId('n');
        t.rootChildren.splice(idx + 1, 0, { kind: 'node', node: copy });
      }
    });
  };

  const insertRootNode = (type: TemplateBlockType, afterKey?: string) => {
    // §7 — insertion supports ANY position: `afterKey` anchors after an
    // existing child; `beforeKey` anchors BEFORE one (used by the
    // insert-here rows); no anchor appends at the end.
    const at = afterKey ? rootIndexOf(afterKey) + 1 : draft.rootChildren.length;
    mutateRoot((t) => {
      t.rootChildren.splice(Math.max(0, at), 0, makeStandaloneChild(type) as RootChild);
    });
  };

  /** §7 — insert a standalone node BEFORE the child with the given key. */
  const insertRootNodeBefore = (type: TemplateBlockType, beforeKey: string) => {
    const idx = rootIndexOf(beforeKey);
    mutateRoot((t) => {
      t.rootChildren.splice(Math.max(0, idx), 0, makeStandaloneChild(type) as RootChild);
    });
  };

  const filesInSection = (section: TemplateSection): number => {
    let count = 0;
    for (const child of section.children) {
      if (child.kind === 'block') {
        count += (state.layoutAssignments[child.block.id] ?? []).length;
      }
    }
    return count;
  };

  // ---- §21 — document fields (derived from the file-level content) ----
  const patchDocumentField = (id: string, patch: Partial<TemplateFieldDefinition>) => {
    mutateRoot((t) => {
      const f = t.fields.find((x) => x.id === id);
      if (f) Object.assign(f, patch);
    });
  };

  const deleteDocumentField = (id: string) => {
    mutateRoot((t) => {
      // §10/§11 — deleting a field removes its bound nodes (top-level and
      // inside containers) and the definition, so it stops existing as a
      // requirement AND as a bind target.
      t.rootChildren = t.rootChildren.filter(
        (c) => !(c.kind === 'node' && c.node.fieldId === id),
      );
      for (const c of t.rootChildren) {
        if (c.kind === 'node') stripFieldBindings(c.node, id);
      }
      t.fields = t.fields.filter((f) => f.id !== id);
    });
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
          {sections.length} section{sections.length === 1 ? '' : 's'} · {rootNodes.length} standalone
          {' '}node{rootNodes.length === 1 ? '' : 's'} · the document renders top to bottom
        </div>
      </div>

      {/* §15 — TAB: Page Settings. Page & Layout belongs to the LAYOUT
          settings; fonts, colors and density stay in the style preset
          (Template editor). */}
      {tab === 'page' && <PageLayoutStudioSection />}

      {/* §15 — TAB: Assignment — file→block pool + export→project pools. */}
      {tab === 'assignment' && (
        <>
          <UnassignedFilesTray
            unassigned={unassigned}
            totalCount={orderedFiles.length}
            sections={sections}
            onAssign={(blockId, fileId) =>
              dispatch({ type: 'ASSIGN_FILE_TO_BLOCK', blockId, fileId })
            }
          />
          <ExportsAssignmentPanel />
        </>
      )}

      {tab === 'structure' && (
      <>
      {draft.rootChildren.length === 0 ? (
        <p className="rounded-md border border-dashed border-app px-3 py-6 text-center text-xs text-muted">
          Empty document — add a section or a standalone node below. Standalone content may appear
          before, between or after sections (§2).
        </p>
      ) : (
        <ol className="space-y-1.5" aria-label="File layout — sections and standalone content">
          {/* §7 — insert BEFORE the first child: standalone nodes can start
              the document without a section above them. */}
          <InsertContentRow
            types={FILE_LEVEL_TYPES}
            onInsert={(type) =>
              insertRootNodeBefore(
                type,
                draft.rootChildren[0]
                  ? draft.rootChildren[0].kind === 'node'
                    ? draft.rootChildren[0].node.id
                    : draft.rootChildren[0].section.id
                  : '',
              )
            }
            label="Insert at top"
          />
          {draft.rootChildren.map((child) => {
            if (child.kind === 'section') {
              const section = child.section;
              return (
                <Fragment key={section.id}>
                <li
                  className="rounded-md border border-app bg-surface/60 p-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="codice-drag-handle text-muted" aria-hidden="true">
                      <ChevronRight size={12} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-primary">
                        {section.name}
                      </span>
                      <span className="text-[10px] text-muted">
                        {sectionTypePreset(section.type).label} · {filesInSection(section)} file
                        {filesInSection(section) === 1 ? '' : 's'} ·{' '}
                        {sectionFieldsInContentOrder(section).length} field
                        {sectionFieldsInContentOrder(section).length === 1 ? '' : 's'}
                      </span>
                    </span>
                    <label className="flex items-center gap-1 text-[10px] text-secondary" title="Start this section on a fresh page">
                      <input
                        type="checkbox"
                        className="h-3 w-3"
                        checked={section.pageBreakBefore}
                        onChange={(e) => {
                          mutateRoot((t) => {
                            const s = templateSections(t).find((x) => x.id === section.id);
                            if (s) s.pageBreakBefore = e.target.checked;
                          });
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
                      <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title={`Duplicate ${section.name}`} aria-label={`Duplicate ${section.name}`} onClick={() => duplicateRootChild(section.id)}>
                        <Copy size={11} />
                      </button>
                      <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Move earlier" aria-label={`Move ${section.name} earlier`} onClick={() => moveRootChild(section.id, -1)}>
                        <ChevronUp size={11} />
                      </button>
                      <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Move later" aria-label={`Move ${section.name} later`} onClick={() => moveRootChild(section.id, 1)}>
                        <ChevronDown size={11} />
                      </button>
                      <button
                        type="button"
                        className="rounded p-0.5 text-muted hover:text-error"
                        title={`Delete ${section.name}`}
                        aria-label={`Delete ${section.name}`}
                        onClick={() => removeRootChild(section.id)}
                      >
                        <Trash size={11} />
                      </button>
                    </span>
                  </div>
                </li>
                {/* §7 — insert BETWEEN children: standalone nodes can sit
                    between two sections. */}
                <InsertContentRow
                  types={FILE_LEVEL_TYPES}
                  onInsert={(type) => insertRootNode(type, section.id)}
                />
                </Fragment>
              );
            }
            // Standalone FILE-LEVEL node (§2) — renders exactly here, in order.
            // §21 — selectable, with the same inspector as any other node and
            // DOCUMENT fields as bind targets (Content → "＋ New field…").
            const node = child.node;
            const nodeSelected = selectedRootNodeId === node.id;
            const nodeFieldLabel = node.fieldId
              ? documentFields.find((f) => f.id === node.fieldId)?.label
              : undefined;
            return (
              <Fragment key={node.id}>
              <li
                className={`rounded-md border bg-surface/40 px-2 py-1.5 ${
                  nodeSelected ? 'border-[var(--color-accent)]' : 'border-dashed border-app'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="codice-drag-handle text-muted" aria-hidden="true">
                    <GripVertical size={12} />
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-xs text-secondary"
                    title="Select to edit content & style"
                    onClick={() => setSelectedRootNodeId(nodeSelected ? null : node.id)}
                  >
                    <span className="font-medium text-primary">{NODE_TYPE_LABELS[node.type]}</span>
                    {nodeFieldLabel ? (
                      <span className="ml-1 text-muted">
                        — bound field: {nodeFieldLabel} (document data, §21)
                      </span>
                    ) : node.text ? (
                      <span className="ml-1 text-muted">— “{node.text.slice(0, 48)}”</span>
                    ) : null}
                  </button>
                  <span className="flex items-center gap-0.5">
                    <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Move earlier" aria-label="Move node earlier" onClick={() => moveRootChild(node.id, -1)}>
                      <ChevronUp size={11} />
                    </button>
                    <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Move later" aria-label="Move node later" onClick={() => moveRootChild(node.id, 1)}>
                      <ChevronDown size={11} />
                    </button>
                    <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Duplicate node" aria-label="Duplicate node" onClick={() => duplicateRootChild(node.id)}>
                      <Copy size={11} />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted hover:text-error"
                      title="Remove node"
                      aria-label="Remove node"
                      onClick={() => {
                        removeRootChild(node.id);
                        if (nodeSelected) setSelectedRootNodeId(null);
                      }}
                    >
                      <Trash size={11} />
                    </button>
                  </span>
                </div>
                {nodeSelected && (
                  <div className="mt-1 border-t border-app pt-1">
                    <NodeInspector
                      node={node}
                      scope="document"
                      documentFields={documentFields}
                      onCreateField={(scope, label, kind) => {
                        if (scope !== 'document') return;
                        // §9 — create the document field AND bind this node in
                        // ONE draft mutation (fields + binding stay in sync).
                        mutateRoot((t) => {
                          const field = newFieldDefinition(label, kind);
                          t.fields.push(field);
                          setNodeFieldBinding(rootNodeRoots(t), node.id, field.id);
                        });
                      }}
                      onPatch={(patch) => {
                        mutateRoot((t) => {
                          const found = findNodeList(rootNodeRoots(t), node.id);
                          if (found) Object.assign(found.list[found.index], patch);
                        });
                      }}
                      onPatchStyle={(patch) => {
                        mutateRoot((t) => {
                          const found = findNodeList(rootNodeRoots(t), node.id);
                          if (found) {
                            found.list[found.index].style = {
                              ...(found.list[found.index].style ?? {}),
                              ...patch,
                            };
                          }
                        });
                      }}
                    />
                  </div>
                )}
              </li>
              <InsertContentRow
                types={FILE_LEVEL_TYPES}
                onInsert={(type) => insertRootNode(type, node.id)}
              />
              </Fragment>
            );
          })}
        </ol>
      )}

      {/* Add section */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-app p-2">
        <Plus size={13} className="text-muted" />
        <select
          className="select w-56"
          value={newType}
          onChange={(e) => setNewType(sanitizeSectionType(e.target.value))}
          aria-label="New section type"
        >
          {Object.values(SECTION_TYPE_PRESETS).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
          {/* Unknown/legacy type strings must degrade, never crash the studio
              (§26 — identity and enums are data; guard the render). */}
          {sectionTypePreset(newType).description}
        </span>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            mutateRoot((t) => {
              // Unknown/legacy type falls back to an empty custom section.
              t.rootChildren.push({ kind: 'section', section: createSection(sanitizeSectionType(newType)) });
            });
          }}
        >
          Add section
        </button>
      </div>

      {/* FILE-LEVEL standalone content add controls (§2/§7) — standalone
          nodes may be placed before, between or after sections. */}
      <div className="rounded-md border border-app p-2" data-tour="layout-file-content">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
            Standalone document content
          </span>
          <span className="text-[10px] text-muted">
            use “Insert here” rows between items for exact placement (§2/§7)
          </span>
        </div>
        <ContentAddControls
          scope="file"
          onAddNode={(type) => insertRootNode(type)}
        />
      </div>

      {/* §21 — document fields, DERIVED from the file-level content order.
          Same pattern as the section fields panel: label/required editing,
          delete removes the bound nodes, plus a fill-content affordance
          writing SET_DOCUMENT_FIELD_VALUES. */}
      <div className="rounded-md border border-app" data-tour="layout-fields">
        <button
          type="button"
          className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs text-secondary transition-colors hover:text-primary"
          onClick={() => setDocFieldsOpen((v) => !v)}
          aria-expanded={docFieldsOpen}
        >
          {docFieldsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="font-medium">Document fields — filled once for the whole export</span>
          <span className="badge">{documentFields.length}</span>
        </button>
        {docFieldsOpen && (
          <div className="space-y-1.5 border-t border-app p-2">
            <p className="text-[10px] text-muted">
              The order mirrors the standalone document content above (§20/§21). Bind a node with its
              “Content” dropdown → “＋ New field…”. Values live in app state and are shared by every
              export that uses this layout.
            </p>
            {documentFields.length === 0 && (
              <p className="px-1 py-2 text-center text-[11px] text-muted">
                No document fields yet — select a standalone node above and use its “Content” dropdown
                → “＋ New field…”.
              </p>
            )}
            {documentFields.map((f) => {
              const filled = Boolean(state.documentFieldValues[f.id]?.trim());
              return (
                <div key={f.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                  <input
                    type="text"
                    className="input w-40 py-0.5"
                    value={f.label}
                    aria-label={`Document field label — ${f.label}`}
                    onChange={(e) => patchDocumentField(f.id, { label: e.target.value })}
                  />
                  <select
                    className="select w-24 py-0.5"
                    value={f.kind}
                    aria-label={`Document field kind — ${f.label}`}
                    onChange={(e) =>
                      patchDocumentField(f.id, { kind: e.target.value as TemplateFieldDefinition['kind'] })
                    }
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
                      onChange={(e) => patchDocumentField(f.id, { required: e.target.checked })}
                    />
                    Required
                  </label>
                  <span
                    className={`text-[10px] ${filled ? 'text-success' : 'text-warning'}`}
                    title={filled ? 'A value is filled in' : 'No value yet — use Fill content'}
                  >
                    {filled ? 'filled' : 'empty'}
                  </span>
                  <button
                    type="button"
                    className="codice-bulk-btn ml-auto"
                    title={`Remove field ${f.label} and its bound content`}
                    aria-label={`Remove field ${f.label} and its bound content`}
                    onClick={() => deleteDocumentField(f.id)}
                  >
                    <Trash size={10} />
                  </button>
                </div>
              );
            })}
            {documentFields.length > 0 && (
              <button type="button" className="codice-bulk-btn" onClick={onFillDocumentContent}>
                Fill content…
              </button>
            )}
          </div>
        )}
      </div>

      {/* §5 — Unassigned files tray — shown on BOTH the structure tab (where
          blocks are composed) and the Assignment tab (the dedicated pool). */}
      <UnassignedFilesTray
        unassigned={unassigned}
        totalCount={orderedFiles.length}
        sections={sections}
        onAssign={(blockId, fileId) =>
          dispatch({ type: 'ASSIGN_FILE_TO_BLOCK', blockId, fileId })
        }
      />
      </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* §5/§12.4 — Unassigned-files pool (shared by structure + assignment)  */
/* ------------------------------------------------------------------ */

function UnassignedFilesTray({
  unassigned,
  totalCount,
  sections,
  onAssign,
}: {
  unassigned: Array<{ projectId: string; projectLabel: string; fileId: string; name: string; path: string }>;
  totalCount: number;
  sections: TemplateSection[];
  onAssign: (blockId: string, fileId: string) => void;
}) {
  return (
    <div className="rounded-md border border-app p-2">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
          Files not in any section
        </span>
        <span className="text-[10px] text-muted">
          {unassigned.length} of {totalCount} selected file{totalCount === 1 ? '' : 's'}
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
                  onAssign(blockId, f.fileId);
                }}
              >
                <option value="">Assign to…</option>
                {sections.flatMap((s) =>
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
  section: TemplateSection;
  orderedFiles: Array<{ projectId: string; projectLabel: string; fileId: string; name: string; path: string }>;
  onFillContent: () => void;
  onEditBlock: (blockId: string) => void;
}) {
  const { state, dispatch } = useAppState();
  const toast = useToast();

  const mutate = (fn: (t: CustomLayoutTemplate, s: TemplateSection) => void) => {
    const next = cloneTemplate(draft);
    const s = templateSections(next).find((x) => x.id === section.id);
    if (!s) return;
    fn(next, s);
    next.updatedAt = Date.now();
    setDraft(next);
  };

  const updateChildren = (next: SectionChild[]) => {
    mutate((_t, s) => {
      s.children = next;
    });
  };

  const assignedInBlock = (blockId: string) => state.layoutAssignments[blockId] ?? [];
  const fileById = (id: string) => orderedFiles.find((f) => f.fileId === id);

  // §20/§11 — LIVE derived section fields: the inspector's bind dropdown
  // derives from content, so deleted nodes/fields never linger.
  const liveSectionFields = sectionFieldsInContentOrder(section);

  // §9 — inspector "＋ New field…": create the section field AND bind the
  // node in ONE mutation (no stale-draft double update).
  const createSectionFieldAndBind = (label: string, kind: TemplateFieldType, bindNodeId: string) => {
    mutate((_t, s) => {
      const field = newFieldDefinition(label, kind);
      s.fields.push(field);
      setNodeFieldBinding(sectionNodeRoots(s), bindNodeId, field.id);
    });
  };

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
        <button type="button" className="codice-bulk-btn" onClick={onFillContent}>
          Fill content
        </button>
      </div>

      {/* §9 — starter structures are appended ONCE per explicit action. */}
      <div className="rounded-md border border-dashed border-app p-2">
        <SectionTypeSeeder
          onAppend={(type) => {
            mutate((_t, s) => {
              appendSectionPreset(s, type);
            });
            toast.push({
              kind: 'info',
              title: `Structure appended — ${sectionTypePreset(type).label}`,
              message: 'The starter fields and content were added once; customize freely.',
            });
          }}
        />
      </div>

      {/* §5/§6 — section fields are DERIVED from the content order. */}
      <SectionFieldsPanel
        section={section}
        onPatchField={(id, patch) =>
          mutate((_t, s) => {
            const f = s.fields.find((x) => x.id === id);
            if (f) Object.assign(f, patch);
          })
        }
        onDeleteField={(id) =>
          mutate((_t, s) => {
            // §6 — deleting a field removes its bound content nodes too,
            // so settings and content can never diverge.
            for (const child of s.children) {
              if (child.kind === 'node') stripFieldBindings(child.node, id);
            }
            s.children = s.children.filter(
              (c) => !(c.kind === 'node' && c.node.fieldId === id),
            );
            s.fields = s.fields.filter((f) => f.id !== id);
          })
        }
      />

      {/* Children — standalone nodes + block refs, in order (§2/§8) */}
      <div className="rounded-md border border-app p-2" data-tour="layout-section-content" data-tour-fallback="layout-children">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
            Section content — ordered
          </span>
          <span className="text-[10px] text-muted">standalone nodes, fields and file blocks, top to bottom</span>
        </div>
        {section.children.length === 0 ? (
          <p className="px-1 py-3 text-center text-xs text-muted">
            Empty — add standalone content or a file block below; bind fields from a node’s
            “Content” dropdown.
          </p>
        ) : (
          <SectionContentList
            items={section.children}
            fields={liveSectionFields}
            allowBlocks
            onUpdate={updateChildren}
            onCreateField={createSectionFieldAndBind}
            blockCards={(child) => (
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
                  <span className="flex items-center gap-0.5">
                    {/* §39 — duplicate the block pattern (fresh ids, unassigned). */}
                    <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title={`Duplicate ${child.block.name}`} aria-label={`Duplicate ${child.block.name}`} onClick={() => {
                      const copyChild: SectionChild = { kind: 'block', block: duplicateBlockDef(child.block) };
                      const idx = section.children.indexOf(child);
                      const next = [...section.children];
                      next.splice(idx + 1, 0, copyChild);
                      updateChildren(next);
                    }}>
                      <Copy size={10} />
                    </button>
                    <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Move block earlier" aria-label={`Move ${child.block.name} earlier`} onClick={() => updateChildren(moveChild(section.children, child.block.id, -1))}>
                      <ChevronUp size={10} />
                    </button>
                    <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Move block later" aria-label={`Move ${child.block.name} later`} onClick={() => updateChildren(moveChild(section.children, child.block.id, 1))}>
                      <ChevronDown size={10} />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted hover:text-error"
                      title={`Remove ${child.block.name}`}
                      aria-label={`Remove ${child.block.name}`}
                      onClick={() => {
                        updateChildren(removeChild(section.children, child.block.id));
                        // Orphaned block assignments are cleared for hygiene (§3).
                        dispatch({ type: 'CLEAR_BLOCK_ASSIGNMENTS', blockId: child.block.id });
                      }}
                    >
                      <Trash size={10} />
                    </button>
                  </span>
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
          />
        )}

        <ContentAddControls
          scope="section"
          onAddNode={(type) => updateChildren([...section.children, makeStandaloneChild(type)])}
        />

        {/* File block presets — the per-file patterns (§3/§9). */}
        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-app pt-2">
          <span className="w-24 flex-shrink-0 text-[10px] text-muted">File block</span>
          {BLOCK_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="codice-input-chip"
              title={p.description}
              onClick={() =>
                updateChildren([
                  ...section.children,
                  {
                    kind: 'block',
                    block: createBlockDef(p.name, p.nodes),
                  },
                ])
              }
            >
              <Plus size={9} /> {p.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
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
      // §8 — the unified Image primitive with the file-attachments source
      // (replaces the legacy "file images" node type).
      { type: 'image', style: { imageSource: 'fileAttachments' } },
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
/* §16/§17 — Page & Layout (moved into the Layout studio)              */
/* ------------------------------------------------------------------ */

const FOOTER_SLOT_OPTIONS: Array<{ value: FooterSlotType; label: string }> = [
  { value: 'none', label: '(none)' },
  { value: 'text', label: 'Custom text' },
  { value: 'pageNumber', label: 'Page number' },
  { value: 'pageCount', label: 'Total pages' },
  { value: 'linesOnPage', label: 'Lines on page' },
  { value: 'fileName', label: 'File name' },
  { value: 'projectName', label: 'Project name' },
  { value: 'date', label: 'Date' },
];

/**
 * Title-page per-field VISIBILITY toggles (§4/§17). The field VALUES are
 * owned by the Document Info metadata dialog — the studio only decides
 * which fields appear on the rendered title page.
 */
const TITLE_PAGE_FIELD_TOGGLES = [
  ['showTitle', 'Title'],
  ['showSubtitle', 'Subtitle'],
  ['showAuthor', 'Author'],
  ['showCourse', 'Course'],
  ['showUniversity', 'University'],
  ['showDate', 'Date'],
  ['showVersion', 'Version'],
  ['showDescription', 'Description'],
] as const;

/** File-header detail toggles — shown only while `fileHeaders.show` is on.
 * The third column is the compact chip label used in the group header. */
const FILE_HEADER_DETAIL_TOGGLES = [
  ['showFileName', 'File name', 'name'],
  ['showRelativePath', 'Relative path', 'path'],
  ['showLanguageLabel', 'Language label', 'lang'],
  ['showFileSize', 'File size', 'size'],
  ['showLineCount', 'Line count', 'lines'],
  ['bold', 'Bold', 'bold'],
] as const;

/**
 * WS-7b — one collapsible §4-gated group of the Page & Layout section
 * (Title Page / Project Structure / File Headers / Project Headers /
 * Table of Contents). The header row keeps the MASTER toggle reachable at
 * all times (§4 — the gate is never hidden inside the collapse) next to a
 * compact state chip; the dependent controls live inside the collapse.
 *
 * While the master gate is OFF only the header + an "off" chip remain —
 * the dependents are unmounted, exactly like the pre-collapsible §4
 * behavior. The chevron rotates (transform transition) and the body
 * collapses via a `grid-template-rows: 0fr → 1fr` transition clipped by
 * `overflow-hidden`, with an opacity/visibility fade so clipped controls
 * are never focusable — no new dependencies, pure Tailwind utilities.
 */
function GatedGroup(props: {
  name: string;
  masterLabel: string;
  masterChecked: boolean;
  onMasterChange: (checked: boolean) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  contentId: string;
  summary: string;
  children: ReactNode;
}) {
  const expanded = props.masterChecked && props.expanded;
  return (
    <div className="rounded border border-app">
      <div className="flex items-center gap-1.5 px-1.5 py-1 transition-colors hover:bg-app/40">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 rounded px-0.5 py-0.5 text-left text-[11px] font-medium text-secondary transition-colors hover:text-primary"
          onClick={props.onToggleExpanded}
          aria-expanded={expanded}
          aria-controls={props.contentId}
        >
          <ChevronDown
            size={11}
            className={`flex-shrink-0 text-muted transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`}
          />
          <span className="truncate">{props.name}</span>
        </button>
        <input
          type="checkbox"
          className="h-3 w-3 flex-shrink-0"
          checked={props.masterChecked}
          aria-label={props.masterLabel}
          title={props.masterLabel}
          onChange={(e) => props.onMasterChange(e.target.checked)}
        />
        <span className="min-w-0 max-w-52 truncate rounded border border-app px-1.5 py-0.5 text-[10px] text-muted">
          {props.masterChecked ? props.summary : 'off'}
        </span>
      </div>
      {props.masterChecked && (
        <div
          id={props.contentId}
          className={`grid transition-[grid-template-rows,opacity,visibility] duration-150 ease-out ${
            expanded ? 'grid-rows-[1fr] opacity-100 visible' : 'grid-rows-[0fr] opacity-0 invisible'
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="space-y-1.5 border-t border-app p-1.5">{props.children}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Page setup for the ACTIVE style preset, re-homed into the Layout studio
 * (§16/§17): page size/orientation/margins, header/footer slots, page
 * breaks, title page and TOC. Fonts, colors and density stay in the style
 * preset (Template editor) — no duplicated controls.
 */
function PageLayoutStudioSection() {
  const { state, dispatch } = useAppState();
  // §15 — this section IS the "Page Settings" tab's content now, so it
  // renders expanded by default (the former accordion no longer hides it).
  const [open, setOpen] = useState(true);
  // WS-7b — per-group collapsibles: Title Page and Table of Contents (the
  // two most-edited groups) start expanded; the three behavioral groups
  // start collapsed so the panel no longer towers when opened.
  const [tpOpen, setTpOpen] = useState(true);
  const [psOpen, setPsOpen] = useState(false);
  const [fhOpen, setFhOpen] = useState(false);
  const [phOpen, setPhOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(true);
  const preset = state.preset;
  const p = preset.page;
  const pb = preset.pageBreaks;
  const tp = preset.titlePage;
  const ps = preset.projectStructure;
  const fh = preset.fileHeaders;
  const ph = preset.projectHeaders;
  const misc = preset.misc;

  const patchPreset = (patch: Partial<DocumentPreset>) =>
    dispatch({ type: 'UPDATE_PRESET', patch });
  const patchPage = (patch: Partial<PageStyle>) => patchPreset({ page: { ...p, ...patch } });
  const patchPageBreaks = (patch: Partial<PageBreakBehavior>) =>
    patchPreset({ pageBreaks: { ...pb, ...patch } });
  // §4 gated groups (restored): each helper patches ONE sub-object so the
  // master toggles and their dependents never reset sibling settings.
  const patchTitlePage = (patch: Partial<TitlePageStyle>) =>
    patchPreset({ titlePage: { ...tp, ...patch } });
  const patchProjectStructure = (patch: Partial<ProjectStructureStyle>) =>
    patchPreset({ projectStructure: { ...ps, ...patch } });
  const patchFileHeaders = (patch: Partial<FileHeaderStyle>) =>
    patchPreset({ fileHeaders: { ...fh, ...patch } });
  const patchProjectHeaders = (patch: Partial<ProjectHeaderStyle>) =>
    patchPreset({ projectHeaders: { ...ph, ...patch } });
  const patchMisc = (patch: Partial<MiscDocumentOptions>) =>
    patchPreset({ misc: { ...misc, ...patch } });
  const patchToc = (patch: Partial<TocStyle>) =>
    patchPreset({ toc: { ...preset.toc, ...patch } });

  // WS-7b — compact header chips summarizing each gated group's state
  // (rendered as "off" by GatedGroup while the master gate is off).
  const tpSummary = `${TITLE_PAGE_FIELD_TOGGLES.filter(([key]) => tp[key]).length} fields on`;
  const psSummary = [
    ...(ps.showFileSizes ? ['sizes'] : []),
    ...(ps.dirsFirst ? ['dirs-first'] : []),
  ].join(', ') || 'tree only';
  const fhSummary =
    FILE_HEADER_DETAIL_TOGGLES.filter(([key]) => fh[key])
      .map(([, , short]) => short)
      .join(', ') || 'none';
  const phSummary = [
    ...(ph.showPath ? ['path'] : []),
    ...(ph.showMetadata ? ['metadata'] : []),
  ].join(', ') || 'title only';
  const tocSummary = `${preset.toc.horizontalAlignment} · ${preset.toc.verticalAlignment}`;

  const marginInput = (label: string, key: 'marginTopMm' | 'marginRightMm' | 'marginBottomMm' | 'marginLeftMm') => (
    <label className="flex items-center gap-1 text-[11px] text-secondary">
      <span className="w-10 flex-shrink-0 text-muted">{label}</span>
      <input
        type="number"
        className="input min-w-0 flex-1 py-0.5"
        min={0}
        value={p[key]}
        aria-label={`Page margin ${label} (mm)`}
        onChange={(e) => patchPage({ [key]: Number(e.target.value) } as Partial<PageStyle>)}
      />
    </label>
  );

  return (
    <div className="rounded-md border border-app">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs text-secondary transition-colors hover:text-primary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <LayoutIcon size={12} />
        <span className="font-medium">Page &amp; Layout</span>
        <span className="ml-1 min-w-0 truncate text-[10px] text-muted">
          {p.size} · {p.landscape ? 'landscape' : 'portrait'} · margins {p.marginTopMm}/{p.marginRightMm}/{p.marginBottomMm}/{p.marginLeftMm} mm
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-app p-2 text-xs">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="label mb-1 block">Page size</span>
              <select
                className="select"
                value={p.size}
                aria-label="Page size"
                onChange={(e) => patchPage({ size: e.target.value as PageStyle['size'] })}
              >
                <option value="A4">A4</option>
                <option value="Letter">Letter</option>
                <option value="Legal">Legal</option>
                <option value="A3">A3</option>
              </select>
            </label>
            <label className="block">
              <span className="label mb-1 block">Orientation</span>
              <select
                className="select"
                value={p.landscape ? 'landscape' : 'portrait'}
                aria-label="Orientation"
                onChange={(e) => patchPage({ landscape: e.target.value === 'landscape' })}
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {marginInput('Top', 'marginTopMm')}
            {marginInput('Right', 'marginRightMm')}
            {marginInput('Bottom', 'marginBottomMm')}
            {marginInput('Left', 'marginLeftMm')}
          </div>

          {/* Header / footer (§17 — the Page Advanced controls moved with it) */}
          <div className="space-y-1.5 rounded border border-app p-1.5">
            <label className="flex items-center gap-1.5 text-[11px] text-secondary">
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={p.pageHeaderShow}
                onChange={(e) => patchPage({ pageHeaderShow: e.target.checked })}
              />
              Show page header (three slots — tokens like {'{title} {projectName} {date}'} work)
            </label>
            {p.pageHeaderShow && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(['pageHeaderLeft', 'pageHeaderCenter', 'pageHeaderRight'] as const).map((key) => (
                  <label key={key} className="block">
                    <span className="label mb-1 block">{key === 'pageHeaderLeft' ? 'Left' : key === 'pageHeaderCenter' ? 'Center' : 'Right'}</span>
                    <input
                      type="text"
                      className="input py-0.5"
                      value={p[key] ?? ''}
                      placeholder="(none)"
                      aria-label={`Header ${key === 'pageHeaderLeft' ? 'left' : key === 'pageHeaderCenter' ? 'center' : 'right'} text`}
                      onChange={(e) => patchPage({ [key]: e.target.value || null } as Partial<PageStyle>)}
                    />
                  </label>
                ))}
              </div>
            )}
            <label className="flex items-center gap-1.5 text-[11px] text-secondary">
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={p.pageFooterShow}
                onChange={(e) => patchPage({ pageFooterShow: e.target.checked })}
              />
              Show page footer
            </label>
            {p.pageFooterShow && (
              <>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {(['pageFooterLeft', 'pageFooterCenter', 'pageFooterRight'] as const).map((key) => (
                    <label key={key} className="block">
                      <span className="label mb-1 block">{key === 'pageFooterLeft' ? 'Left' : key === 'pageFooterCenter' ? 'Center' : 'Right'}</span>
                      <select
                        className="select py-0.5"
                        value={p[key]}
                        aria-label={`Footer ${key === 'pageFooterLeft' ? 'left' : key === 'pageFooterCenter' ? 'center' : 'right'} slot`}
                        onChange={(e) =>
                          patchPage({ [key]: e.target.value as FooterSlotType } as Partial<PageStyle>)
                        }
                      >
                        {FOOTER_SLOT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <label className="block">
                  <span className="label mb-1 block">Footer custom text (for “Custom text” slots)</span>
                  <input
                    type="text"
                    className="input py-0.5"
                    value={p.pageFooterText ?? ''}
                    placeholder="Page {page} of {pages}"
                    aria-label="Footer custom text"
                    onChange={(e) => patchPage({ pageFooterText: e.target.value })}
                  />
                </label>
              </>
            )}
          </div>

          <div className="space-y-1 rounded border border-app p-1.5">
            <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted">Page breaks</div>
            {([
              ['afterTitlePage', 'Page break after the title page'],
              ['beforeProject', 'Page break before each project'],
              ['beforeFile', 'Page break before each file'],
              ['beforeH1', 'Page break before each H1'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5 text-[11px] text-secondary">
                <input
                  type="checkbox"
                  className="h-3 w-3"
                  checked={pb[key]}
                  onChange={(e) => patchPageBreaks({ [key]: e.target.checked } as Partial<PageBreakBehavior>)}
                />
                {label}
              </label>
            ))}
          </div>

          {/* ---- §4 gated groups (restored in WS-6d, made collapsible in
               WS-7b): Title Page / Project Structure / File Headers /
               Project Headers / Table of Contents. Each group's master gate
               stays in the collapsible header (always reachable); the
               dependents live inside the collapse and DISAPPEAR while the
               master toggle is off. ---- */}

          {/* Title page — per-field VISIBILITY gates only; the field VALUES
              are edited in the Document Info (metadata) dialog, not here.
              Expanded by default (WS-7b). */}
          <GatedGroup
            name="Title Page"
            masterLabel="Title page"
            masterChecked={tp.enabled}
            onMasterChange={(checked) => patchTitlePage({ enabled: checked })}
            expanded={tpOpen}
            onToggleExpanded={() => setTpOpen((v) => !v)}
            contentId="studio-group-title-page"
            summary={tpSummary}
          >
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {TITLE_PAGE_FIELD_TOGGLES.map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5 text-[11px] text-secondary">
                  <input
                    type="checkbox"
                    className="h-3 w-3"
                    checked={tp[key]}
                    aria-label={`Show ${label} on the title page`}
                    onChange={(e) =>
                      patchTitlePage({ [key]: e.target.checked } as Partial<TitlePageStyle>)
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="block">
                <span className="label mb-1 block">Alignment</span>
                <select
                  className="select min-w-0 py-0.5"
                  value={tp.alignment}
                  aria-label="Title page alignment"
                  onChange={(e) => patchTitlePage({ alignment: e.target.value as Alignment })}
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </label>
              <label className="block">
                <span className="label mb-1 block">Vertical alignment</span>
                <select
                  className="select min-w-0 py-0.5"
                  value={tp.verticalAlignment}
                  aria-label="Title page vertical alignment"
                  onChange={(e) =>
                    patchTitlePage({ verticalAlignment: e.target.value as VerticalAlignment })
                  }
                >
                  <option value="top">Top</option>
                  <option value="center">Center</option>
                  <option value="bottom">Bottom</option>
                </select>
              </label>
              <label className="block">
                <span className="label mb-1 block">Vertical offset (pt)</span>
                <input
                  type="number"
                  className="input min-w-0 py-0.5"
                  min={0}
                  value={tp.verticalOffsetPt}
                  aria-label="Title page vertical offset (pt)"
                  onChange={(e) =>
                    patchTitlePage({ verticalOffsetPt: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <p className="text-[10px] text-muted">
              Field values (title, author, …) are edited in the document Metadata dialog (Document Info) — only their visibility lives here.
            </p>
          </GatedGroup>

          {/* Project structure — behavioral toggles; typography stays in the
              Template editor (Fonts Settings → Project Structure).
              Collapsed by default (WS-7b). */}
          <GatedGroup
            name="Project Structure"
            masterLabel="Include project structure"
            masterChecked={ps.enabled}
            onMasterChange={(checked) => patchProjectStructure({ enabled: checked })}
            expanded={psOpen}
            onToggleExpanded={() => setPsOpen((v) => !v)}
            contentId="studio-group-project-structure"
            summary={psSummary}
          >
            <label className="flex items-center gap-1.5 text-[11px] text-secondary">
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={ps.showFileSizes}
                aria-label="Show file sizes"
                onChange={(e) => patchProjectStructure({ showFileSizes: e.target.checked })}
              />
              Show file sizes
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-secondary">
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={ps.dirsFirst}
                aria-label="Directories first"
                onChange={(e) => patchProjectStructure({ dirsFirst: e.target.checked })}
              />
              Directories first
            </label>
            <p className="text-[10px] text-muted">
              Tree typography (font, size, indent) lives in the Template editor.
            </p>
          </GatedGroup>

          {/* File headers — header content toggles behind the master gate.
              Collapsed by default (WS-7b). */}
          <GatedGroup
            name="File Headers"
            masterLabel="Show file headers"
            masterChecked={fh.show}
            onMasterChange={(checked) => patchFileHeaders({ show: checked })}
            expanded={fhOpen}
            onToggleExpanded={() => setFhOpen((v) => !v)}
            contentId="studio-group-file-headers"
            summary={fhSummary}
          >
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {FILE_HEADER_DETAIL_TOGGLES.map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5 text-[11px] text-secondary">
                  <input
                    type="checkbox"
                    className="h-3 w-3"
                    checked={fh[key]}
                    aria-label={label}
                    onChange={(e) =>
                      patchFileHeaders({ [key]: e.target.checked } as Partial<FileHeaderStyle>)
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </GatedGroup>

          {/* Project headers — project title gate + detail toggles.
              Collapsed by default (WS-7b). */}
          <GatedGroup
            name="Project Headers"
            masterLabel="Show project title"
            masterChecked={ph.showTitle}
            onMasterChange={(checked) => patchProjectHeaders({ showTitle: checked })}
            expanded={phOpen}
            onToggleExpanded={() => setPhOpen((v) => !v)}
            contentId="studio-group-project-headers"
            summary={phSummary}
          >
            <label className="flex items-center gap-1.5 text-[11px] text-secondary">
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={ph.showPath}
                aria-label="Show project path"
                onChange={(e) => patchProjectHeaders({ showPath: e.target.checked })}
              />
              Show project path
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-secondary">
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={ph.showMetadata}
                aria-label="Show project metadata"
                onChange={(e) => patchProjectHeaders({ showMetadata: e.target.checked })}
              />
              Show metadata
            </label>
          </GatedGroup>

          {/* Table of contents — alignment + numbering behind the TOC gate.
              Expanded by default (WS-7b). */}
          <GatedGroup
            name="Table of Contents"
            masterLabel="Table of contents"
            masterChecked={misc.includeToc}
            onMasterChange={(checked) => patchMisc({ includeToc: checked })}
            expanded={tocOpen}
            onToggleExpanded={() => setTocOpen((v) => !v)}
            contentId="studio-group-table-of-contents"
            summary={tocSummary}
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="label mb-1 block">Horizontal alignment</span>
                <select
                  className="select min-w-0 py-0.5"
                  value={preset.toc.horizontalAlignment}
                  aria-label="TOC horizontal alignment"
                  onChange={(e) =>
                    patchToc({ horizontalAlignment: e.target.value as Alignment })
                  }
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </label>
              <label className="block">
                <span className="label mb-1 block">Vertical alignment</span>
                <select
                  className="select min-w-0 py-0.5"
                  value={preset.toc.verticalAlignment}
                  aria-label="TOC vertical alignment"
                  onChange={(e) =>
                    patchToc({ verticalAlignment: e.target.value as VerticalAlignment })
                  }
                >
                  <option value="top">Top</option>
                  <option value="center">Center</option>
                  <option value="bottom">Bottom</option>
                </select>
              </label>
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-secondary">
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={misc.numberHeadings}
                aria-label="Number headings"
                onChange={(e) => patchMisc({ numberHeadings: e.target.checked })}
              />
              Number headings
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-secondary">
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={misc.showFileMetadata}
                aria-label="Show file metadata"
                onChange={(e) => patchMisc({ showFileMetadata: e.target.checked })}
              />
              Show file metadata
            </label>
          </GatedGroup>
          <p className="text-[10px] text-muted">
            These settings live with the active style preset (page geometry is preset-wide).
            Fonts, colors and density remain in the Template editor (§17).
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* §25/§26 — Exports: project assignment + first page (§43/§44)        */
/* ------------------------------------------------------------------ */

function ExportsAssignmentPanel() {
  const { state, dispatch } = useAppState();
  const [open, setOpen] = useState(false);
  const groups = state.exportGroups;
  const projects = state.projects;
  const assignedProjectIds = new Set(groups.flatMap((g) => g.projectIds));
  const unassignedProjects = projects.filter((p) => !assignedProjectIds.has(p.id));

  const updateGroup = (g: ExportGroup, patch: Partial<ExportGroup>) =>
    dispatch({ type: 'UPDATE_EXPORT_GROUP', group: { ...g, ...patch } });

  // §14 — count/mode helpers were removed with the duplicated controls:
  // the Export rail owns export count + per-project mode exclusively.

  const projectLabel = (pid: string) =>
    projects.find((p) => p.id === pid)?.label ?? pid;
  const projectFileCount = (pid: string) =>
    projects.find((p) => p.id === pid)?.files.length ?? 0;

  return (
    <div className="rounded-md border border-app">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs text-secondary transition-colors hover:text-primary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="font-medium">Exports — project assignment</span>
        <span className="badge">{groups.length}</span>
        <span className="ml-1 text-[10px] text-muted">
          {groups.length === 0
            ? 'single export by default'
            : `${unassignedProjects.length} project${unassignedProjects.length === 1 ? '' : 's'} unassigned`}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-app p-2">
          {/* §14 — export COUNT and per-project mode live in the EXPORT RAIL
              only (no duplicated controls). This panel owns the per-export
              assignment view: which projects land in which export document,
              plus each export's first-page choice (§43/§44). */}
          <p className="rounded border border-dashed border-app px-2 py-1.5 text-[10px] text-muted">
            Set the NUMBER of exports and the per-project export mode in the Export rail (right
            side). Here you decide which projects belong to each export and how each one starts.
          </p>

          {groups.length === 0 && (
            <p className="rounded border border-dashed border-app px-2 py-3 text-center text-[11px] text-muted">
              No export groups — exporting produces one document with all selected projects.
              Use “＋” or “One export per project” to split it.
            </p>
          )}

          {groups.map((g) => {
            const layout = g.layoutId
              ? state.customLayouts.find((t) => t.id === g.layoutId)
              : null;
            const fileCount = g.projectIds.reduce((acc, pid) => acc + projectFileCount(pid), 0);
            return (
              <div key={g.id} className="space-y-1.5 rounded-md border border-app bg-surface/60 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    className="input w-44 py-0.5 text-xs"
                    value={g.name}
                    aria-label="Export name"
                    onChange={(e) => updateGroup(g, { name: e.target.value })}
                  />
                  <span className="text-[10px] text-muted">
                    {g.projectIds.length} project{g.projectIds.length === 1 ? '' : 's'} · {fileCount} file{fileCount === 1 ? '' : 's'}
                  </span>
                  <span className="text-[10px] text-muted" title="The layout this export uses (§27)">
                    layout: {layout ? layout.name : 'default (applied)'}
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    {/* §43/§44 — first page per export: preset / title / cover */}
                    <select
                      className="select w-44 py-0.5 text-[11px]"
                      value={g.firstPage ?? 'preset'}
                      aria-label={`First page for ${g.name}`}
                      title="Title page OR cover page — never both (§43)"
                      onChange={(e) => {
                        const v = e.target.value as ExportGroup['firstPage'];
                        updateGroup(g, {
                          firstPage: v,
                          coverId: v === 'cover' ? g.coverId : undefined,
                        });
                      }}
                    >
                      <option value="preset">First page: follow template preset</option>
                      <option value="title">First page: title page</option>
                      <option value="cover">First page: cover page</option>
                    </select>
                    {(g.firstPage ?? 'preset') === 'cover' && (
                      <select
                        className="select w-44 py-0.5 text-[11px]"
                        value={g.coverId ?? ''}
                        aria-label={`Cover page for ${g.name}`}
                        onChange={(e) => updateGroup(g, { coverId: e.target.value || undefined })}
                      >
                        {state.coverPages.length === 0 ? (
                          <option value="">No covers imported yet — import in the Export rail</option>
                        ) : (
                          <>
                            <option value="">— pick a cover —</option>
                            {state.coverPages.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </>
                        )}
                      </select>
                    )}
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted hover:text-error"
                      title={`Delete export ${g.name}`}
                      aria-label={`Delete export ${g.name}`}
                      onClick={() => dispatch({ type: 'DELETE_EXPORT_GROUP', id: g.id })}
                    >
                      <Trash size={10} />
                    </button>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {g.projectIds.map((pid) => (
                    <span
                      key={pid}
                      className="flex items-center gap-1 rounded border border-app px-1.5 py-0.5 text-[10px] text-secondary"
                      title={`${projectLabel(pid)} — ${projectFileCount(pid)} file${projectFileCount(pid) === 1 ? '' : 's'}`}
                    >
                      <span className="max-w-[160px] truncate">{projectLabel(pid)}</span>
                      <span className="text-muted">({projectFileCount(pid)})</span>
                      <button
                        type="button"
                        className="text-muted hover:text-error"
                        title={`Remove ${projectLabel(pid)} from this export`}
                        aria-label={`Remove ${projectLabel(pid)} from this export`}
                        onClick={() =>
                          updateGroup(g, { projectIds: g.projectIds.filter((x) => x !== pid) })
                        }
                      >
                        <X size={9} />
                      </button>
                    </span>
                  ))}
                  {unassignedProjects.length > 0 && (
                    <select
                      className="select w-40 py-0.5 text-[11px]"
                      value=""
                      aria-label={`Add a project to ${g.name}`}
                      onChange={(e) => {
                        const pid = e.target.value;
                        if (!pid) return;
                        updateGroup(g, { projectIds: [...g.projectIds, pid] });
                      }}
                    >
                      <option value="">＋ Add project…</option>
                      {unassignedProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label} ({p.files.length} file{p.files.length === 1 ? '' : 's'})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            );
          })}

          {/* Unassigned projects footer (§25) */}
          <div className="rounded border border-dashed border-app px-2 py-1.5">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">Unassigned projects</div>
            {unassignedProjects.length === 0 ? (
              <p className="text-[11px] text-muted">
                Every project is assigned to an export.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {unassignedProjects.map((p) => (
                  <span
                    key={p.id}
                    className="rounded border border-app px-1.5 py-0.5 text-[10px] text-secondary"
                    title={`${p.label} — ${p.files.length} file${p.files.length === 1 ? '' : 's'} — not in any export`}
                  >
                    {p.label} <span className="text-muted">({p.files.length})</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <p className="text-[10px] text-muted">
            Export assignment decides which PROJECTS go into which export document. Which FILES render
            where is decided by block assignment above (§26) — the two are related but distinct.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* §27 — picker shown when an export tab has no layout yet             */
/* ------------------------------------------------------------------ */

function ExportLayoutPicker({
  group,
  onPick,
  onCreate,
}: {
  group: ExportGroup;
  onPick: (layoutId: string) => void;
  onCreate: () => void;
}) {
  const { state } = useAppState();
  return (
    <div className="space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold text-primary">Layout for export “{group.name}”</h3>
        <p className="text-[11px] text-muted">
          This export has no layout of its own yet — choose an existing layout or create a new one
          (§27). Exports without a specific layout use the globally applied one.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="select w-64"
          value=""
          aria-label={`Choose a layout for export ${group.name}`}
          onChange={(e) => {
            const layoutId = e.target.value;
            if (layoutId) onPick(layoutId);
            e.target.value = '';
          }}
        >
          <option value="">Choose layout for this export…</option>
          {state.customLayouts.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({templateSections(t).length} section{templateSections(t).length === 1 ? '' : 's'})
            </option>
          ))}
        </select>
        <button type="button" className="btn-secondary" onClick={onCreate}>
          <Plus size={13} /> New layout for this export
        </button>
      </div>
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
  section: TemplateSection;
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
      for (const s of templateSections(t)) {
        for (const child of s.children) {
          if (child.kind === 'block' && child.block.id === block.id) fn(child.block);
        }
      }
    });
  };

  const nodes = block.nodes;
  const assigned = state.layoutAssignments[block.id] ?? [];

  // §20/§11 — LIVE derived field lists: the inspector's Content dropdown
  // and the fields panel both derive from the pattern content, so deleted
  // nodes/fields can never linger as bind targets.
  const liveSectionFields = sectionFieldsInContentOrder(section);
  const liveBlockFields = blockFieldsInContentOrder(
    block,
    new Set(liveSectionFields.map((f) => f.id)),
  );

  // §9 — inspector "＋ New field…": create the field (block OR section
  // scope) AND bind the selected node in ONE update mutation.
  const createFieldAndBind = (
    scope: 'block' | 'section',
    label: string,
    kind: TemplateFieldType,
  ) => {
    if (!selectedNodeId) return;
    const field = newFieldDefinition(label, kind);
    update((t) => {
      for (const s of templateSections(t)) {
        if (scope === 'section' && s.id === section.id) s.fields.push(field);
        for (const child of s.children) {
          if (child.kind !== 'block' || child.block.id !== block.id) continue;
          if (scope === 'block') child.block.fields.push(field);
          // Bind the selected node inside the pattern (every node edited by
          // the Block editor lives in this block).
          setNodeFieldBinding(child.block.nodes, selectedNodeId, field.id);
        }
      }
    });
  };

  // §10 — files already assigned to ANY block (this one included) are
  // excluded from this block's dropdown. Unassigning frees the file again.
  const available = useMemo(() => {
    const taken = assignedFileIds(draft, state.layoutAssignments);
    return orderedFiles.filter((f) => !taken.has(f.fileId));
  }, [draft, state.layoutAssignments, orderedFiles]);

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

      {/* Block fields (§4/§20 — per-file scope, DERIVED from the pattern,
          same rule as section fields) */}
      <BlockFieldsPanel
        block={block}
        sectionFields={liveSectionFields}
        onPatchField={(id, patch) =>
          mutateBlock((b) => {
            const f = b.fields.find((x) => x.id === id);
            if (f) Object.assign(f, patch);
          })
        }
        onDeleteField={(id) =>
          mutateBlock((b) => {
            // §20 — deleting a block field removes the pattern nodes bound
            // to it (mirroring section behavior), then the definition.
            b.nodes = b.nodes.filter((n) => n.fieldId !== id);
            for (const n of b.nodes) stripFieldBindings(n, id);
            b.fields = b.fields.filter((f) => f.id !== id);
          })
        }
      />

      {/* Node tree (the original block editor capabilities, §9) */}
      <NodeTreeEditor
        nodes={nodes}
        fields={liveBlockFields}
        sectionFields={liveSectionFields}
        selectedId={selectedNodeId}
        collapsed={collapsed}
        onSelect={onSelectNode}
        onToggleCollapse={onToggleCollapse}
        onCreateField={(scope, label, kind) => {
          if (scope === 'block' || scope === 'section') createFieldAndBind(scope, label, kind);
        }}
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
          <option value="">
            {orderedFiles.length === 0
              ? 'No selected files — upload a project first'
              : available.length === 0
                ? 'Every file is already assigned to a block'
                : '+ Assign a file…'}
          </option>
          {/* §10 — a file assigned to ANY block disappears from every
              assignment dropdown (this one included). Unassign it there
              first; the model-level reducer guard remains as the final
              one-file-one-section enforcement. */}
          {available.map((f) => (
            <option key={f.fileId} value={f.fileId}>
              {f.path} ({f.projectLabel})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
