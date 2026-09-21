/**
 * Export panel — orchestrates the export pipeline.
 *
 * Output modes when multiple projects are present:
 *   - combined: all projects in one document
 *   - separate: one document per project, packaged into a ZIP
 *   - groups: named export groups (§11/§22-§24) — each group is ONE export
 *     document with its own project set (no section leakage between
 *     exports, §30), its own layout template (§27) and its own first page:
 *     preset title page / forced title page / imported cover page (§43/§44).
 *
 * The rail also hosts the cover page library (§42): imported one-page .docx
 * covers, preserved exactly as authored — spliced verbatim into DOCX exports
 * and flow-rendered (text, formatting, images — best effort) into PDF exports.
 *
 * Uses the toast system for success/error notifications.
 */

import { templateSections, type CustomLayoutTemplate } from '@/lib/customLayouts/model';
import { findCustomLayout } from '@/lib/customLayouts/storage';
import { importCoverDocx } from '@/lib/coverPages';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppState, type OutputMode } from '@/hooks/useAppState';
import { useToast, useToastOptional } from '@/components/common/Toast';
import { buildDocumentModel } from '@/lib/documentBuilder';
import { getExporter, runExport } from '@/lib/exporters';
import { presetToOptions } from '@/lib/presets/presetToOptions';
import {
  groupExportFilename,
  sanitizeFilename,
} from '@/lib/groupFilename';
import {
  resolveCustomLayout,
  type ResolutionInputs,
} from '@/lib/customLayouts/resolver';
import {
  validateCustomLayout,
  formatMissingRequirements,
  unassignedFileIds,
} from '@/lib/customLayouts/validation';
import { SectionContentDialog } from '@/components/CustomLayout/SectionContentDialog';
import type { TemplateFieldDefinition } from '@/lib/customLayouts/model';
import { normalizeImageFiles, ACCEPTED_IMAGE_TYPES } from '@/lib/imageAssets';
import {
  createHistoryEntry,
  pushHistory,
  clearHistory,
  formatRelativeTime,
  formatSize,
  downloadHistoryEntry,
  type ExportHistoryEntry,
} from '@/lib/exportHistory';
import {
  loadExportHistory,
  saveExportHistory,
  clearExportHistory,
} from '@/lib/exportHistoryStorage';
import { planGenerateAll, summarizeGroup } from '@/lib/generateAll';
import type {
  CoverPageAsset,
  DocumentModel,
  DocumentOptions,
  ExportGroup,
  ExportResult,
  ProjectEntry,
} from '@/types';
import JSZip from 'jszip';
import { planSnapshot, buildSnapshotZip } from '@/lib/sourceSnapshot';
import { assignDocumentNames, type ArchivePreviewEntry } from '@/lib/archivePreview';
import { ArchivePreviewDialog } from '@/components/common/ArchivePreviewDialog';
import {
  Download,
  Loader,
  X,
  Clock,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Trash,
  Package,
  Check,
  ImagePlus,
  Plus,
  GripVertical,
  Pencil,
  Play,
  Copy,
  Layers,
} from '@/components/common/Icons';

/** Sentinel error used to unwind the export pipeline on user cancel. */
class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'ExportCancelled';
  }
}

/** Generate a fresh export-group id (§11). */
function newGroupId(): string {
  return `grp-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/**
 * §43 — first-page semantics for ONE export, applied by cloning the preset
 * options (the preset itself is never mutated):
 *   - 'title'  → the generated title page is forced ON regardless of preset
 *   - 'cover'  → the title page is suppressed; the imported cover becomes
 *                page 1 (the DOCX exporter splices it in verbatim, §42; the
 *                PDF exporter flow-renders it — see lib/coverPdf.ts)
 *   - 'preset' → unchanged preset behaviour (default)
 */
function optionsForFirstPage(
  base: DocumentOptions,
  firstPage: 'preset' | 'title' | 'cover' | undefined,
): DocumentOptions {
  if (firstPage === 'title') return { ...base, includeFrontMatter: true };
  if (firstPage === 'cover') return { ...base, includeFrontMatter: false };
  return base;
}

export function ExportPanel() {
  const { state, dispatch, getSelectedFiles } = useAppState();
  const toast = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [isSnapshotting, setIsSnapshotting] = useState(false);
  const cancelRequested = useRef(false);
  const [progress, setProgress] = useState<{
    phase: string;
    done: number;
    total: number;
    currentPath?: string;
  } | null>(null);

  // ---- Per-project progress (separate-ZIP mode checklist) ----
  const [projectProgress, setProjectProgress] = useState<
    Record<
      string,
      {
        status: 'pending' | 'highlighting' | 'exporting' | 'done';
        done?: number;
        total?: number;
      }
    >
  >({});
  const resetProjectProgress = useCallback((projects: ProjectEntry[]) => {
    const map: Record<string, { status: 'pending' | 'highlighting' | 'exporting' | 'done' }> = {};
    for (const p of projects) map[p.id] = { status: 'pending' };
    setProjectProgress(map);
  }, []);

  // ---- Export history (re-download without re-exporting) ----
  // R15 — entries also persist to IndexedDB (metadata + blob), so history
  // and its re-download survive reloads. Storage stays best-effort: any
  // failure silently degrades to the old session-scoped behavior.
  const [history, setHistory] = useState<ExportHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<ExportHistoryEntry[]>([]);
  historyRef.current = history;
  // Guards the save effect: never write before the initial load resolved
  // (a premature [] would wipe the persisted store).
  const historyHydratedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    loadExportHistory().then((restored) => {
      if (cancelled) return;
      historyHydratedRef.current = true;
      if (restored.length === 0) return;
      // Merge UNDER any in-session entries (a same-tick export keeps its
      // top position); dedupe by id in the impossible double-restore race.
      setHistory((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const under = restored.filter((e) => !seen.has(e.id));
        return under.length > 0 ? [...prev, ...under] : prev;
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    return () => {
      clearHistory(historyRef.current);
    };
  }, []);
  // R15 — debounced persist on every history change after hydration.
  useEffect(() => {
    if (!historyHydratedRef.current) return;
    const t = window.setTimeout(() => {
      void saveExportHistory(historyRef.current);
    }, 300);
    return () => window.clearTimeout(t);
  }, [history]);

  // ---- Archive preview dialog (Source ZIP / separate-mode export) ----
  const [archivePreview, setArchivePreview] = useState<
    { kind: 'snapshot' | 'separate'; entries: ArchivePreviewEntry[] } | null
  >(null);

  const totalSelected = state.projects.reduce(
    (acc, p) => acc + getSelectedFiles(p.id).size,
    0,
  );

  /** Projects that currently contribute selected files (they are the only
   * exportable units — used by every mode and by the §23 count line). */
  const activeProjects = state.projects.filter(
    (p) => getSelectedFiles(p.id).size > 0,
  );

  /** Resolve a layout template against a built model's projects (§17).
   *
   * Carries the full resolver input set: document-level field values (§21)
   * and the preset's panel text color (§12/§14) included. */
  const resolveForModel = useCallback(
    (
      template: (typeof state.customLayouts)[number],
      projects: DocumentModel['projects'],
    ) => {
      const inputs: ResolutionInputs = {
        projects,
        fileDetails: state.fileDetails,
        fileFieldValues: state.fileFieldValues,
        sectionFieldValues: state.sectionFieldValues,
        documentFieldValues: state.documentFieldValues,
        fileOrder: state.fileOrder,
        assignments: state.layoutAssignments,
        imageAssets: Object.fromEntries(state.imageAssets.map((a) => [a.id, a])),
        metadata: state.metadata,
        fileCount: projects.reduce((acc, p) => acc + p.files.length, 0),
        panelText: state.preset.colors.panelText,
      };
      return resolveCustomLayout(template, inputs);
    },
    [
      state.fileDetails,
      state.fileFieldValues,
      state.sectionFieldValues,
      state.documentFieldValues,
      state.fileOrder,
      state.layoutAssignments,
      state.imageAssets,
      state.metadata,
      state.preset,
    ],
  );

  /** Build a DocumentModel for a single project — including per-file user
   * content (details/images, §6-§12) and the resolved custom layout (§32).
   *
   * Separate-mode (per-project ZIP) exports have NO group record, so they
   * always use the SHARED applied layout and the preset's own first-page
   * setting — never a per-export layout or an imported cover (§26: export
   * assignment is group-based; use Export groups for per-export config). */
  const buildProjectModel = useCallback(
    async (
      project: ProjectEntry,
      onProgress?: (done: number, total: number, currentPath?: string) => void,
    ): Promise<DocumentModel> => {
      const selectedFileIds = getSelectedFiles(project.id);
      const model = await buildDocumentModel(
        [{ project, selectedFileIds, order: state.fileOrder[project.id] }],
        presetToOptions(state.preset),
        state.metadata,
        onProgress,
        {
          fileDetails: state.fileDetails,
          fileImages: state.fileImages,
          imageAssets: state.imageAssets,
        },
      );
      const appliedLayout = state.customLayouts.find(
        (t) => t.id === state.appliedLayoutId,
      );
      if (appliedLayout) {
        model.customLayout = resolveForModel(appliedLayout, model.projects);
      }
      return model;
    },
    [
      state.preset,
      state.metadata,
      state.fileOrder,
      state.fileDetails,
      state.fileImages,
      state.imageAssets,
      state.customLayouts,
      state.appliedLayoutId,
      state.fileFieldValues,
      state.documentFieldValues,
      getSelectedFiles,
      resolveForModel,
    ],
  );

  /** §27/§44 — layout resolution for ONE export document:
   *   - "same layout for all exports" → the shared applied layout
   *   - otherwise the group's own `layoutId` (falling back to the shared
   *     applied layout when it is unset or no longer exists)
   * A group-less export (combined / separate modes) always gets the shared
   * applied layout. */
  const layoutForExport = useCallback(
    (group?: Pick<ExportGroup, 'layoutId'> | null): CustomLayoutTemplate | undefined => {
      const appliedLayout = state.customLayouts.find(
        (t) => t.id === state.appliedLayoutId,
      );
      if (state.sameLayoutForAllExports || !group?.layoutId) return appliedLayout;
      return findCustomLayout(group.layoutId) ?? appliedLayout;
    },
    [state.sameLayoutForAllExports, state.customLayouts, state.appliedLayoutId],
  );

  /** §5 — required-field validation BEFORE any export work. Returns true
   * (and shows the error toast) when the export must be blocked. Works
   * through the actual resolved layout/data pipeline — never a hardcoded
   * field list — and identifies the section/block/file that failed.
   *
   * §27/§30 — `layoutOverride` is the layout the EXPORT will actually use
   * (the group's own template for per-export layouts); it defaults to the
   * shared applied layout. */
  const validateBeforeExport = useCallback(
    (
      projects: ProjectEntry[],
      layoutOverride?: CustomLayoutTemplate | undefined,
    ): boolean => {
      const layout =
        layoutOverride ??
        state.customLayouts.find((t) => t.id === state.appliedLayoutId);
      if (!layout) return false;
      const docProjects = projects.map((p) => ({
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
      }));
      const missing = validateCustomLayout({
        template: layout,
        projects: docProjects,
        fileDetails: state.fileDetails,
        fileFieldValues: state.fileFieldValues,
        sectionFieldValues: state.sectionFieldValues,
        documentFieldValues: state.documentFieldValues,
        fileAssignments: state.layoutAssignments,
      });
      if (missing.length > 0) {
        toast.push({
          kind: 'error',
          title: 'Cannot export — required fields are missing',
          message: formatMissingRequirements(missing),
          durationMs: 12000,
        });
        return true;
      }
      // Non-blocking: files assigned to no block are silently left out —
      // surface a warning instead of exporting a surprise.
      const unassigned = unassignedFileIds({
        template: layout,
        projects: docProjects,
        fileDetails: state.fileDetails,
        fileFieldValues: state.fileFieldValues,
        sectionFieldValues: state.sectionFieldValues,
        documentFieldValues: state.documentFieldValues,
        fileAssignments: state.layoutAssignments,
      });
      if (unassigned.length > 0) {
        toast.push({
          kind: 'warning',
          title: `${unassigned.length} file${unassigned.length === 1 ? '' : 's'} not in this layout`,
          message:
            'Files assigned to no block are not part of a custom layout export — assign them in the Layout studio (File layout editor).',
          durationMs: 8000,
        });
      }
      return false;
    },
    [
      state.customLayouts,
      state.appliedLayoutId,
      state.fileDetails,
      state.fileFieldValues,
      state.sectionFieldValues,
      state.documentFieldValues,
      state.layoutAssignments,
      getSelectedFiles,
      toast,
    ],
  );

  /** Trigger a browser download for a single blob. */
  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Progress callback that aborts the pipeline when cancel is requested. */
  const watchCancel = useCallback(
    (done: number, total: number, currentPath?: string) => {
      if (cancelRequested.current) {
        throw new ExportCancelled();
      }
      setProgress({
        phase: 'Highlighting files',
        done,
        total,
        currentPath,
      });
    },
    [],
  );

  const handleExport = useCallback(async (skipPreview = false) => {
    if (state.projects.length === 0 || totalSelected === 0) {
      toast.push({
        kind: 'warning',
        title: 'No files selected',
        message: 'Add a project and select files before exporting.',
      });
      return;
    }
    // §11 — in groups mode each group has its own Generate button (the main
    // one is disabled); keyboard Ctrl+E should not bypass that either.
    if (state.outputMode === 'groups') return;

    // §29 — validate required custom-layout fields FIRST. A missing value
    // blocks the export: no partial document is ever generated.
    if (validateBeforeExport(activeProjects)) return;
    if (
      !skipPreview &&
      state.outputMode === 'separate' &&
      activeProjects.length > 1
    ) {
      const extension = getExporter(state.outputFormat).extension;
      const names = assignDocumentNames(
        activeProjects.map((p) => p.label),
        extension,
      );
      setArchivePreview({
        kind: 'separate',
        entries: names.map((name, i) => ({
          path: name,
          badge: `${getSelectedFiles(activeProjects[i].id).size} files`,
        })),
      });
      return;
    }

    cancelRequested.current = false;
    setIsExporting(true);
    setProgress({ phase: 'Building document model', done: 0, total: 0 });
    const loadingToastId = toast.push({
      kind: 'loading',
      title: 'Generating document…',
      message:
        state.outputMode === 'separate' && state.projects.length > 1
          ? `Packaging ${state.projects.length} documents into a ZIP`
          : `Exporting to ${state.outputFormat.toUpperCase()}`,
      durationMs: 0,
    });

    try {
      const exporter = getExporter(state.outputFormat);
      const extension = exporter.extension;

      if (state.outputMode === 'combined' || activeProjects.length <= 1) {
        // Single combined document.
        const projectInputs = activeProjects.map((project) => ({
          project,
          selectedFileIds: getSelectedFiles(project.id),
          order: state.fileOrder[project.id],
        }));
        const model = await buildDocumentModel(
          projectInputs,
          presetToOptions(state.preset),
          state.metadata,
          watchCancel,
          {
            fileDetails: state.fileDetails,
            fileImages: state.fileImages,
            imageAssets: state.imageAssets,
          },
        );
        // §32 — attach the resolved custom layout to the SAME model.
        const appliedLayout = state.customLayouts.find(
          (t) => t.id === state.appliedLayoutId,
        );
        if (appliedLayout) {
          model.customLayout = resolveForModel(appliedLayout, model.projects);
        }
        setProgress({
          phase: `Exporting to ${state.outputFormat.toUpperCase()}`,
          done: 0,
          total: 0,
        });
        const result = await runExport(exporter, model, {
          format: state.outputFormat,
          filename: state.outputFilename || 'Codice_Output',
        });
        downloadBlob(result.blob, result.filename);
        setHistory((prev) =>
          pushHistory(
            prev,
            createHistoryEntry({
              blob: result.blob,
              filename: result.filename,
              format: state.outputFormat,
              elapsedMs: result.elapsedMs,
              detail: `${totalSelected} file${totalSelected === 1 ? '' : 's'}`,
            }),
          ),
        );
        toast.dismiss(loadingToastId);
        toast.push({
          kind: 'success',
          title: 'Document generated',
          message: `${result.filename} · ${(result.blob.size / 1024).toFixed(1)} KB · ${Math.round(result.elapsedMs)}ms`,
        });
      } else {
        // Separate documents — one per project, packaged into a ZIP.
        //
        // §26/§27 — per-project exports have NO group record: they always
        // use the SHARED applied layout (see buildProjectModel), the
        // preset's own first-page setting, and no imported cover. Export
        // assignment is group-based — switch to Export groups mode for
        // per-export layout / cover configuration.
        const zip = new JSZip();
        const usedNames = new Set<string>();
        let totalMs = 0;
        let totalSize = 0;
        let count = 0;
        resetProjectProgress(activeProjects);
        for (const project of activeProjects) {
          setProgress({
            phase: `Processing ${project.label}`,
            done: count,
            total: activeProjects.length,
          });
          setProjectProgress((prev) => ({
            ...prev,
            [project.id]: { status: 'highlighting', done: 0, total: 0 },
          }));
          const model = await buildProjectModel(project, (done, total, currentPath) => {
            if (cancelRequested.current) throw new ExportCancelled();
            setProgress({
              phase: `Highlighting ${project.label}`,
              done,
              total,
              currentPath,
            });
            setProjectProgress((prev) => ({
              ...prev,
              [project.id]: { status: 'highlighting', done, total },
            }));
          });
          setProgress({
            phase: `Exporting ${project.label}`,
            done: count,
            total: activeProjects.length,
          });
          setProjectProgress((prev) => ({
            ...prev,
            [project.id]: { status: 'exporting' },
          }));
          const result = await runExport(exporter, model, {
            format: state.outputFormat,
            filename: sanitizeFilename(project.label),
          });
          // Avoid filename collisions inside the ZIP.
          let name = result.filename;
          let i = 1;
          while (usedNames.has(name)) {
            name = `${sanitizeFilename(project.label)}_${i}.${extension}`;
            i++;
          }
          usedNames.add(name);
          zip.file(name, result.blob);
          totalMs += result.elapsedMs;
          totalSize += result.blob.size;
          count++;
          setProjectProgress((prev) => ({
            ...prev,
            [project.id]: {
              status: 'done',
              done: 1,
              total: 1,
            },
          }));
        }
        setProgress({
          phase: 'Packaging ZIP',
          done: activeProjects.length,
          total: activeProjects.length,
        });
        const zipBlob = await zip.generateAsync({
          type: 'blob',
          mimeType: 'application/zip',
        });
        const zipName = `${state.outputFilename || 'Codice_Output'}.zip`;
        downloadBlob(zipBlob, zipName);
        setHistory((prev) =>
          pushHistory(
            prev,
            createHistoryEntry({
              blob: zipBlob,
              filename: zipName,
              format: 'zip',
              elapsedMs: totalMs,
              detail: `${activeProjects.length} documents`,
            }),
          ),
        );
        toast.dismiss(loadingToastId);
        toast.push({
          kind: 'success',
          title: `${activeProjects.length} documents packaged`,
          message: `${zipName} · ${(zipBlob.size / 1024).toFixed(1)} KB · ${Math.round(totalMs)}ms total`,
        });
      }
    } catch (err) {
      toast.dismiss(loadingToastId);
      if (err instanceof ExportCancelled) {
        toast.push({
          kind: 'info',
          title: 'Export cancelled',
          message: 'No document was generated.',
        });
      } else {
        toast.push({
          kind: 'error',
          title: 'Export failed',
          message: err instanceof Error ? err.message : 'Unknown error',
          durationMs: 10000,
        });
      }
    } finally {
      setIsExporting(false);
      setProgress(null);
      setProjectProgress({});
    }
  }, [
    state.projects,
    state.preset,
    state.metadata,
    state.outputFormat,
    state.outputMode,
    state.outputFilename,
    totalSelected,
    getSelectedFiles,
    toast,
    buildProjectModel,
    watchCancel,
    resetProjectProgress,
    state.fileOrder,
    state.fileDetails,
    state.fileImages,
    state.imageAssets,
    state.customLayouts,
    state.appliedLayoutId,
    state.fileFieldValues,
    state.documentFieldValues,
    validateBeforeExport,
    resolveForModel,
  ]);

  /** Export exactly the projects of ONE export group as a single combined
   * document (§11 — arbitrary project combinations; a project may belong
   * to any number of groups).
   *
   * §22/§27/§43/§44 — the GROUP is the per-export configuration record:
   * it decides which projects appear (its model contains ONLY those
   * projects — no section leakage between exports, §30), which layout
   * template resolves (its own when per-export layouts are enabled), and
   * what the first page is (preset / forced title page / imported cover). */
  const handleExportGroup = useCallback(
    async (groupId: string): Promise<boolean> => {
      const group = state.exportGroups.find((g) => g.id === groupId);
      if (!group) return false;
      const groupProjects = state.projects.filter(
        (p) => group.projectIds.includes(p.id) && getSelectedFiles(p.id).size > 0,
      );
      if (groupProjects.length === 0) {
        toast.push({
          kind: 'warning',
          title: 'Empty group',
          message: `“${group.name}” has no projects with selected files.`,
        });
        return false;
      }
      // §27 — resolve THIS export's layout (the group's own template when
      // per-export layouts are enabled, else the shared applied layout).
      const layout = layoutForExport(group);
      // §5/§27 — validation scoped to exactly the group's projects AND run
      // against the SAME layout this export will render with.
      if (validateBeforeExport(groupProjects, layout)) return false;

      // §43 — first-page semantics. A 'cover' export whose cover asset no
      // longer exists falls back to the preset behaviour (defensive — the
      // UI clears the reference when a cover is removed).
      const wantsCover = group.firstPage === 'cover';
      const cover = wantsCover
        ? state.coverPages.find((c) => c.id === group.coverId)
        : undefined;
      const effectiveFirstPage: 'preset' | 'title' | 'cover' =
        wantsCover && !cover ? 'preset' : (group.firstPage ?? 'preset');

      cancelRequested.current = false;
      setIsExporting(true);
      setProgress({ phase: `Building “${group.name}”`, done: 0, total: 0 });
      const loadingToastId = toast.push({
        kind: 'loading',
        title: `Generating “${group.name}”…`,
        message: `${groupProjects.length} project${groupProjects.length === 1 ? '' : 's'} → ${state.outputFormat.toUpperCase()}`,
        durationMs: 0,
      });
      try {
        const exporter = getExporter(state.outputFormat);
        const projectInputs = groupProjects.map((project) => ({
          project,
          selectedFileIds: getSelectedFiles(project.id),
          order: state.fileOrder[project.id],
        }));
        // §43 — the first-page choice overrides the preset's title-page
        // setting for THIS export only (cloned options; the preset itself
        // is never mutated).
        const options = optionsForFirstPage(
          presetToOptions(state.preset),
          effectiveFirstPage,
        );
        const model = await buildDocumentModel(
          projectInputs,
          options,
          state.metadata,
          watchCancel,
          {
            fileDetails: state.fileDetails,
            fileImages: state.fileImages,
            imageAssets: state.imageAssets,
          },
        );
        // §27/§30 — resolve the layout against ONLY this group's projects
        // so per-export section content is correct and no content leaks
        // in from projects outside the group.
        if (layout) {
          model.customLayout = resolveForModel(layout, model.projects);
        }
        setProgress({
          phase: `Exporting “${group.name}” to ${state.outputFormat.toUpperCase()}`,
          done: 0,
          total: 0,
        });
        const base = state.outputFilename || 'Codice_Output';
        // R12 — per-group filename override ({title}/{group}/{date} tokens);
        // without one the default stays `{base}_{group}` (pre-R12 behavior).
        const result = await runExport(exporter, model, {
          format: state.outputFormat,
          filename: groupExportFilename(group, base),
          // §42 — the DOCX exporter splices the cover in as page 1
          // (verbatim); the PDF and ODT exporters flow-render it (best
          // effort — a failed render is signalled via coverSkipped).
          ...(cover ? { cover } : {}),
        });
        downloadBlob(result.blob, result.filename);
        setHistory((prev) =>
          pushHistory(
            prev,
            createHistoryEntry({
              blob: result.blob,
              filename: result.filename,
              format: state.outputFormat,
              elapsedMs: result.elapsedMs,
              detail: `group: ${group.name}`,
            }),
          ),
        );
        toast.dismiss(loadingToastId);
        toast.push({
          kind: 'success',
          title: 'Group document generated',
          message: `${result.filename} · ${(result.blob.size / 1024).toFixed(1)} KB`,
        });
        // §42 — a requested cover that failed to render (PDF/ODT
        // flow-rendering) is signalled via coverSkipped: warn once per
        // export. DOCX splices the cover verbatim and cannot fail here.
        if (result.coverSkipped) {
          toast.push({
            kind: 'warning',
            title: 'Cover page skipped',
            message: `The cover page for “${group.name}” could not be rendered — the export continued without it.`,
            durationMs: 8000,
          });
        }
        return true;
      } catch (err) {
        toast.dismiss(loadingToastId);
        if (err instanceof ExportCancelled) {
          toast.push({ kind: 'info', title: 'Export cancelled', message: 'No document was generated.' });
        } else {
          toast.push({
            kind: 'error',
            title: 'Export failed',
            message: err instanceof Error ? err.message : 'Unknown error',
            durationMs: 10000,
          });
        }
        return false;
      } finally {
        setIsExporting(false);
        setProgress(null);
      }
    },
    [
      state.exportGroups,
      state.projects,
      state.coverPages,
      state.outputFormat,
      state.outputFilename,
      state.preset,
      state.metadata,
      state.fileOrder,
      state.fileDetails,
      state.fileImages,
      state.imageAssets,
      getSelectedFiles,
      toast,
      validateBeforeExport,
      resolveForModel,
      layoutForExport,
      watchCancel,
    ],
  );

  /** R14 — generate EVERY exportable group sequentially (§11, one click
   * covers the whole scaffold). Skips groups with no live project (a
   * persisted scaffold after reload) and reports the outcome in a summary
   * toast; per-group toasts still stream as each document finishes. Each
   * group's export re-validates itself — a validation failure skips that
   * group without aborting the rest. */
  const handleExportAllGroups = useCallback(
    async (groupIds: string[]) => {
      if (groupIds.length === 0) {
        toast.push({
          kind: 'warning',
          title: 'Nothing to generate',
          message: 'No group has projects with selected files yet.',
        });
        return;
      }
      let generated = 0;
      let failed = 0;
      for (const id of groupIds) {
        const ok = await handleExportGroup(id);
        if (ok) generated += 1;
        else failed += 1;
      }
      const skipped = groupIds.length - generated - failed;
      const parts: string[] = [];
      if (generated > 0) parts.push(`${generated} generated`);
      if (failed > 0) parts.push(`${failed} failed`);
      if (skipped > 0) parts.push(`${skipped} skipped (empty)`);
      toast.push({
        kind: failed > 0 ? 'warning' : 'success',
        title: failed > 0 ? 'Generate all finished with warnings' : 'All groups generated',
        message: parts.join(' · '),
        durationMs: failed > 0 ? 8000 : undefined,
      });
    },
    [handleExportGroup, toast],
  );

  // Ctrl/Cmd+E dispatches 'codice:export' — run the latest export handler.
  const exportRef = useRef(handleExport);
  useEffect(() => {
    exportRef.current = handleExport;
  });
  useEffect(() => {
    const onCommand = () => {
      void exportRef.current();
    };
    window.addEventListener('codice:export', onCommand);
    return () => window.removeEventListener('codice:export', onCommand);
  }, []);

  /** Open the archive preview for the Source ZIP flow. */
  const handleSnapshotRequest = useCallback(() => {
    if (state.projects.length === 0 || totalSelected === 0) {
      toast.push({
        kind: 'warning',
        title: 'No files selected',
        message: 'Select files before downloading a source snapshot.',
      });
      return;
    }
    const plan = planSnapshot(state.projects, getSelectedFiles);
    if (plan.entries.length === 0) {
      toast.push({
        kind: 'warning',
        title: 'Nothing to package',
        message: 'No readable files were selected.',
      });
      return;
    }
    setArchivePreview({
      kind: 'snapshot',
      entries: plan.entries.map((e) => ({ path: e.zipPath, size: e.size })),
    });
  }, [state.projects, totalSelected, getSelectedFiles, toast]);

  /** Package the selected source files into a ZIP snapshot. */
  const handleSnapshot = useCallback(async () => {
    if (state.projects.length === 0 || totalSelected === 0) {
      toast.push({
        kind: 'warning',
        title: 'No files selected',
        message: 'Select files before downloading a source snapshot.',
      });
      return;
    }
    setIsSnapshotting(true);
    const loadingId = toast.push({
      kind: 'loading',
      title: 'Packaging source snapshot…',
      message: `Zipping ${totalSelected} file${totalSelected === 1 ? '' : 's'}`,
      durationMs: 0,
    });
    try {
      const plan = planSnapshot(state.projects, getSelectedFiles);
      const result = await buildSnapshotZip(
        plan,
        `${state.outputFilename || 'Codice_Source'}_sources`,
      );
      toast.dismiss(loadingId);
      if (!result) {
        toast.push({
          kind: 'warning',
          title: 'Nothing to package',
          message: 'No readable files were selected.',
        });
        return;
      }
      downloadBlob(result.blob, result.filename);
      setHistory((prev) =>
        pushHistory(
          prev,
          createHistoryEntry({
            blob: result.blob,
            filename: result.filename,
            format: 'zip',
            elapsedMs: result.elapsedMs,
            detail: `${result.fileCount} source file${result.fileCount === 1 ? '' : 's'}`,
          }),
        ),
      );
      toast.push({
        kind: 'success',
        title: 'Source snapshot ready',
        message: `${result.filename} · ${(result.blob.size / 1024).toFixed(1)} KB · ${Math.round(result.elapsedMs)}ms`,
      });
    } catch (err) {
      toast.dismiss(loadingId);
      toast.push({
        kind: 'error',
        title: 'Snapshot failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        durationMs: 10000,
      });
    } finally {
      setIsSnapshotting(false);
    }
  }, [state.projects, state.outputFilename, totalSelected, getSelectedFiles, toast]);

  /** Confirm the open archive preview → run the real pipeline. */
  const confirmArchivePreview = useCallback(() => {
    if (!archivePreview) return;
    const kind = archivePreview.kind;
    setArchivePreview(null);
    if (kind === 'snapshot') void handleSnapshot();
    else void exportRef.current(true);
  }, [archivePreview, handleSnapshot]);

  const showModeToggle = activeProjects.length > 1;

  // ---- §23/§24 — number of export files + grouping quick actions -------

  /** Replace the current export groups wholesale (used by the quick
   * actions and the per-project toggle). Removed groups' projects simply
   * become unassigned. */
  const replaceExportGroups = (
    groups: Array<Pick<ExportGroup, 'name' | 'projectIds'>>,
  ) => {
    for (const g of state.exportGroups) {
      dispatch({ type: 'DELETE_EXPORT_GROUP', id: g.id });
    }
    for (const g of groups) {
      dispatch({ type: 'ADD_EXPORT_GROUP', group: { id: newGroupId(), ...g } });
    }
  };

  /** §23 — grow/shrink the export list by a delta (BUG-008: the old
   * absolute-target version read a stale state snapshot under rapid
   * clicks and misnamed every appended group "Export 1"). */
  const setExportFileCount = (target: number) => {
    // Kept for callers that already know an absolute target; the stepper
    // buttons dispatch ADJUST_EXPORT_GROUP_COUNT directly instead.
    const next = Math.max(0, Math.floor(target));
    dispatch({
      type: 'ADJUST_EXPORT_GROUP_COUNT',
      delta: next - state.exportGroups.length,
    });
  };

  /** §24 — one export per active project, named after its project. */
  const oneExportPerProject = () =>
    replaceExportGroups(
      activeProjects.map((p) => ({ name: p.label, projectIds: [p.id] })),
    );

  /** §24 — a single export containing every active project. */
  const singleExportGroup = () =>
    replaceExportGroups([
      { name: 'All projects', projectIds: activeProjects.map((p) => p.id) },
    ]);

  /** §24 — derived: the current groups ARE exactly one-per-project (in
   * project order). Manually defined groups show as unchecked, which is
   * how the toggle interacts with them. */
  const isOnePerProject =
    activeProjects.length > 0 &&
    state.exportGroups.length === activeProjects.length &&
    state.exportGroups.every(
      (g, i) =>
        g.projectIds.length === 1 && g.projectIds[0] === activeProjects[i].id,
    );

  // spec §13 — the export controls live in a compact VERTICAL rail between
  // the sidebar and the preview (the former bottom footer is gone). The
  // whole panel scrolls if the viewport is short; progress and history
  // render below the controls.
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 overflow-y-auto p-3">
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-secondary">
          <Download size={12} />
          Export
        </div>
        <div className="space-y-2">
          <div>
            <label className="label block mb-1">Filename</label>
            <input
              type="text"
              className="input"
              value={state.outputFilename}
              onChange={(e) =>
                dispatch({ type: 'SET_OUTPUT_FILENAME', filename: e.target.value })
              }
            />
          </div>
          <div>
            <label className="label block mb-1">Format</label>
            <select
              className="select"
              value={state.outputFormat}
              onChange={(e) =>
                dispatch({
                  type: 'SET_OUTPUT_FORMAT',
                  format: e.target.value as 'docx' | 'pdf' | 'odt',
                })
              }
            >
              <option value="docx">DOCX (Word)</option>
              <option value="pdf">PDF</option>
              <option value="odt">ODT (OpenDocument)</option>
            </select>
          </div>
          <div>
            <label className="label block mb-1">Mode</label>
            <select
              className="select"
              value={state.outputMode}
              onChange={(e) =>
                dispatch({
                  type: 'SET_OUTPUT_MODE',
                  mode: e.target.value as OutputMode,
                })
              }
              disabled={!showModeToggle && state.outputMode === 'combined'}
              title={
                showModeToggle
                  ? 'Choose how to package multiple projects'
                  : state.outputMode === 'combined'
                    ? 'Only available with multiple projects selected'
                    : 'Current packaging mode — add another project to change grouping, or switch back to Combined'
              }
            >
              <option value="combined">Combined (single document)</option>
              <option value="separate">Separate (ZIP archive)</option>
              <option value="groups">Export groups (arbitrary sets)</option>
            </select>
          </div>

          {/* §23/§24 — number of export files + grouping quick actions,
              shown in groups mode next to the Mode select. BUG-009 (R15):
              shown whenever groups mode is ACTIVE — the old `showModeToggle`
              gate hid the stepper for <2 projects, so a single-project user
              in groups mode had a disabled Generate pointing at a groups
              editor that was not rendered at all. Entering groups mode is
              an explicit opt-in (the Mode select is disabled for a
              single-project combined state), so the UI must follow. */}
          {state.outputMode === 'groups' && (
            <div className="codice-groups-stepper space-y-1.5 rounded border border-app p-2">
              <div className="flex items-center justify-between gap-2">
                <label className="label mb-0">Number of export files</label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="codice-bulk-btn !px-1.5"
                    aria-label="Decrease the number of export files"
                    title="Remove the last export (its projects become unassigned)"
                    disabled={state.exportGroups.length === 0}
                    onClick={() => dispatch({ type: 'ADJUST_EXPORT_GROUP_COUNT', delta: -1 })}
                  >
                    −
                  </button>
                  <span
                    className="min-w-5 text-center text-xs tabular-nums text-primary"
                    aria-live="polite"
                  >
                    {state.exportGroups.length}
                  </span>
                  <button
                    type="button"
                    className="codice-bulk-btn !px-1.5"
                    aria-label="Increase the number of export files"
                    title="Append a new export"
                    onClick={() => dispatch({ type: 'ADJUST_EXPORT_GROUP_COUNT', delta: 1 })}
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className="codice-bulk-btn"
                  title="Replace the groups with one export per project with selected files"
                  onClick={oneExportPerProject}
                >
                  One export per project
                </button>
                <button
                  type="button"
                  className="codice-bulk-btn"
                  title="Replace the groups with a single export containing every project"
                  onClick={singleExportGroup}
                >
                  Single export
                </button>
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-secondary">
                <input
                  type="checkbox"
                  checked={isOnePerProject}
                  onChange={(e) => {
                    if (e.target.checked) oneExportPerProject();
                    else if (isOnePerProject) singleExportGroup();
                  }}
                />
                <span>Export each project as its own file</span>
              </label>
              <p className="text-[10px] text-muted">
                Also available as Separate mode. Enabling replaces the current
                groups with one export per project.
              </p>
              <label className="flex items-center gap-1.5 text-[11px] text-secondary">
                <input
                  type="checkbox"
                  checked={state.sameLayoutForAllExports}
                  onChange={(e) =>
                    dispatch({
                      type: 'SET_SAME_LAYOUT_FOR_ALL',
                      value: e.target.checked,
                    })
                  }
                />
                <span>Use the same layout for all exports</span>
              </label>
              <p className="text-[10px] text-muted">
                When off, pick a layout per export in the Layout editor's export
                tabs.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* §42 — cover page library: imported one-page .docx covers. */}
      <CoversPanel />

      {/* §11 — export groups: named, ordered project sets; each exports as
          one document and a project may belong to any number of groups.
          WS-9c — the panel also renders with FEWER than two projects when
          persisted group scaffolds exist, so a reload shows the user's
          naming work instead of hiding it until projects return.
          BUG-009 (R15) — now rendered in groups mode UNCONDITIONALLY: the
          disabled Generate hint says "pick an export group above", so the
          editor must exist above in every state that can reach the hint
          (1 project + zero groups included). */}
      {state.outputMode === 'groups' && (
        <ExportGroupsUI
          isExporting={isExporting}
          onExportGroup={(id) => void handleExportGroup(id)}
          onExportAllGroups={(ids) => void handleExportAllGroups(ids)}
        />
      )}

      {/* §21 — content inputs for the applied custom layout: document-level
          and per-project fields are filled here; per-file fields live in
          File properties. Required fields are validated before export. */}
      <LayoutContentFields />

      <div className="space-y-1.5">
        <div className="text-[11px] text-muted">
          {showModeToggle
            ? state.outputMode === 'combined'
              ? `${activeProjects.length} projects → 1 document`
              : state.outputMode === 'groups'
                ? `${activeProjects.length} projects → ${state.exportGroups.length} export file${state.exportGroups.length === 1 ? '' : 's'}`
                : `${activeProjects.length} projects → ZIP archive`
            : `${totalSelected} file${totalSelected === 1 ? '' : 's'} selected`}
        </div>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            className="btn-secondary w-full justify-center"
            onClick={handleSnapshotRequest}
            disabled={isSnapshotting || isExporting || totalSelected === 0}
            title="Preview and download the selected source files as a ZIP archive — mirrors the document's contents"
          >
            {isSnapshotting ? (
              <Loader size={14} className="animate-spin" />
            ) : (
              <Package size={14} />
            )}
            <span>Source ZIP</span>
          </button>
          <button
            className="btn-primary w-full justify-center"
            onClick={() => void handleExport()}
            disabled={
              isExporting ||
              totalSelected === 0 ||
              state.outputMode === 'groups'
            }
            title={
              state.outputMode === 'groups'
                ? 'Pick an export group above and press its Generate button'
                : undefined
            }
          >
            {isExporting ? (
              <>
                <Loader size={14} className="animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Download size={14} />
                Generate
              </>
            )}
          </button>
        </div>
      </div>

      <ArchivePreviewDialog
        open={archivePreview !== null}
        title={
          archivePreview?.kind === 'separate'
            ? 'Export archive preview'
            : 'Source ZIP preview'
        }
        subtitle={
          archivePreview?.kind === 'separate'
            ? `One ${state.outputFormat.toUpperCase()} document per project, packaged into "${
                state.outputFilename || 'Codice_Output'
              }.zip"`
            : `The selected sources mirrored under "${
                state.outputFilename || 'Codice_Source'
              }_sources.zip"`
        }
        entries={archivePreview?.entries ?? []}
        confirmLabel={
          archivePreview?.kind === 'separate'
            ? `Export ${state.outputFormat.toUpperCase()} archive`
            : 'Download ZIP'
        }
        onConfirm={confirmArchivePreview}
        onCancel={() => setArchivePreview(null)}
      />

      {progress && (
        <div className="rounded-md border border-app bg-surface p-2">
          <div className="flex items-center gap-2 text-xs text-secondary">
            <Loader size={12} className="animate-spin" />
            <span className="flex-1">{progress.phase}…</span>
            <button
              type="button"
              className="flex flex-shrink-0 items-center gap-1 rounded border border-app px-1.5 py-0.5 text-[11px] text-secondary transition-colors hover:border-error hover:text-error"
              onClick={() => {
                cancelRequested.current = true;
              }}
              aria-label="Cancel export"
            >
              <X size={11} />
              Cancel
            </button>
          </div>
          {progress.total > 0 && (
            <>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded" style={{ background: 'var(--color-border-muted)' }}>
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${(progress.done / progress.total) * 100}%`,
                    background: 'var(--color-accent)',
                  }}
                />
              </div>
              {progress.currentPath && (
                <div className="mt-1 truncate text-[10px] text-muted">
                  {progress.currentPath}
                </div>
              )}
            </>
          )}

          {Object.keys(projectProgress).length > 0 && (
            <div
              className="codice-fade-in mt-2 space-y-0.5 border-t border-app pt-2"
              role="list"
              aria-label="Per-project export progress"
            >
              {Object.entries(projectProgress).map(([projectId, pp]) => {
                const project = state.projects.find((p) => p.id === projectId);
                if (!project) return null;
                const label =
                  pp.status === 'done'
                    ? `${sanitizeFilename(project.label)}.${state.outputFormat}`
                    : project.label;
                return (
                  <div
                    key={projectId}
                    role="listitem"
                    className="codice-progress-row flex items-center gap-1.5 text-[11px]"
                  >
                    <span className="codice-progress-icon flex-shrink-0">
                      {pp.status === 'done' ? (
                        <Check size={11} />
                      ) : pp.status === 'pending' ? (
                        <span className="codice-progress-dot" />
                      ) : (
                        <Loader size={11} className="animate-spin" />
                      )}
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate ${
                        pp.status === 'done'
                          ? 'text-secondary'
                          : pp.status === 'pending'
                            ? 'text-muted'
                            : 'text-primary'
                      }`}
                      title={label}
                    >
                      {label}
                    </span>
                    {pp.status === 'highlighting' &&
                      typeof pp.total === 'number' &&
                      pp.total > 0 && (
                        <span className="codice-progress-mini" aria-hidden="true">
                          <span
                            style={{
                              width: `${Math.round(((pp.done ?? 0) / pp.total) * 100)}%`,
                            }}
                          />
                        </span>
                      )}
                    <span className="flex-shrink-0 text-[10px] tabular-nums text-muted">
                      {pp.status === 'pending'
                        ? 'queued'
                        : pp.status === 'highlighting'
                          ? `${pp.done ?? 0}/${pp.total ?? 0}`
                          : pp.status === 'exporting'
                            ? 'writing'
                            : 'done'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="rounded-md border border-app bg-surface/60">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs text-secondary transition-colors hover:text-primary"
            onClick={() => setHistoryOpen((o) => !o)}
            aria-expanded={historyOpen}
          >
            {historyOpen ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} />
            )}
            <Clock size={13} className="text-muted" />
            <span className="font-medium">Recent exports</span>
            <span className="badge ml-0.5">{history.length}</span>
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear export history"
              title="Clear history (frees memory and removes the saved exports)"
              className="ml-auto rounded p-0.5 text-muted transition-colors hover:text-error"
              onClick={(e) => {
                e.stopPropagation();
                setHistory((prev) => clearHistory(prev));
                void clearExportHistory();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  e.preventDefault();
                  setHistory((prev) => clearHistory(prev));
                  void clearExportHistory();
                }
              }}
            >
              <Trash size={12} />
            </span>
          </button>
          {historyOpen && (
            <div className="codice-fade-in max-h-44 space-y-0.5 overflow-y-auto px-1.5 pb-1.5">
              {history.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="codice-history-row"
                  title={`Download ${entry.filename} again`}
                  onClick={() => downloadHistoryEntry(entry)}
                >
                  <span
                    className={`codice-format-chip codice-format-${entry.format}`}
                  >
                    {entry.format.toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-primary">
                      {entry.filename}
                    </span>
                    <span className="block text-[10px] text-muted">
                      {formatSize(entry.sizeBytes)} · {formatRelativeTime(entry.at)}
                      {entry.detail ? ` · ${entry.detail}` : ''}
                    </span>
                  </span>
                  <Download size={13} className="flex-shrink-0 text-muted" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* §8 — applied layout content: section fields filled here via the      */
/* SectionContentDialog; block (per-file) fields live in File           */
/* properties. Required fields are validated before export.             */
/* ------------------------------------------------------------------ */

function LayoutContentFields() {
  const { state } = useAppState();
  const appliedLayout = state.customLayouts.find(
    (t) => t.id === state.appliedLayoutId,
  );
  const [open, setOpen] = useState(false);
  const [contentTarget, setContentTarget] = useState<{
    sectionId: string;
    sectionName: string;
    fields: TemplateFieldDefinition[];
  } | null>(null);

  if (!appliedLayout) return null;

  return (
    <div className="rounded-md border border-app bg-surface/60">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs text-secondary transition-colors hover:text-primary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="codice-layout-fields"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="font-medium">“{appliedLayout.name}” content</span>
        <span className="badge">{templateSections(appliedLayout).length} sections</span>
      </button>
      {open && (
        <div id="codice-layout-fields" className="codice-fade-in space-y-2 border-t border-app p-2">
          {templateSections(appliedLayout).length === 0 && (
            <p className="text-[11px] text-muted">
              This template has no sections.
            </p>
          )}
          {templateSections(appliedLayout).map((section) => {
            const values = state.sectionFieldValues[section.id] ?? {};
            const requiredMissing = section.fields.filter(
              (f) => f.required && !(values[f.id] ?? '').trim(),
            );
            return (
              <div
                key={section.id}
                className="flex items-center gap-2 rounded border border-app px-2 py-1.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-primary">{section.name}</span>
                  <span className="text-[10px] text-muted">
                    {section.fields.length} field{section.fields.length === 1 ? '' : 's'}
                    {section.fields.length > 0 && (
                      <>
                        {' · '}
                        {requiredMissing.length > 0 ? (
                          <span className="font-semibold text-warning">
                            {requiredMissing.length} required missing
                          </span>
                        ) : (
                          'filled'
                        )}
                      </>
                    )}
                  </span>
                </span>
                {section.fields.length > 0 && (
                  <button
                    type="button"
                    className="codice-bulk-btn"
                    onClick={() =>
                      setContentTarget({
                        sectionId: section.id,
                        sectionName: section.name,
                        fields: section.fields,
                      })
                    }
                  >
                    Fill content
                  </button>
                )}
              </div>
            );
          })}
          <p className="text-[10px] text-muted">
            Per-file block fields live in{' '}
            <strong className="text-secondary">File properties</strong>{' '}
            (right-click a file in the tree).
          </p>
        </div>
      )}
      {contentTarget && (
        <SectionContentDialog
          sectionId={contentTarget.sectionId}
          sectionName={contentTarget.sectionName}
          fields={contentTarget.fields}
          onClose={() => setContentTarget(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* §42 — cover page library: imported one-page .docx covers, kept        */
/* exactly as authored; DOCX exports splice them in as page 1, PDF       */
/* exports flow-render them (best effort). Persisted across sessions    */
/* in IndexedDB with a 20-cover / ~50 MB cap (WS-8a, lib/coverStorage).  */
/* ------------------------------------------------------------------ */

function CoversPanel() {
  const { state, dispatch } = useAppState();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  /** Import a picked .docx as a cover page asset (§42). The parser keeps
   * the FIRST PAGE only — everything else is ignored. */
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const cover = await importCoverDocx(file);
      dispatch({ type: 'ADD_COVER_PAGE', cover });
      toast.push({
        kind: 'success',
        title: 'Cover page added — first page only',
        message: cover.truncated
          ? `Only the first page of the ${cover.pageCount}-page document is used.`
          : 'Pick it as the first page of an export below (First page → Cover page).',
        durationMs: 6000,
      });
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Cover page import failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        durationMs: 10000,
      });
    } finally {
      setImporting(false);
    }
  };

  const commitRename = (cover: CoverPageAsset) => {
    const name = editName.trim();
    setEditingId(null);
    if (name && name !== cover.name) {
      dispatch({ type: 'RENAME_COVER_PAGE', id: cover.id, name });
    }
  };

  /** Remove a cover and clear every per-export reference to it (§44):
   * exports configured with it fall back to the preset first page. */
  const removeCover = (id: string) => {
    dispatch({ type: 'REMOVE_COVER_PAGE', id });
    for (const group of state.exportGroups) {
      if (group.coverId === id) {
        dispatch({
          type: 'UPDATE_EXPORT_GROUP',
          group: {
            ...group,
            coverId: undefined,
            firstPage: group.firstPage === 'cover' ? 'preset' : group.firstPage,
          },
        });
      }
    }
  };

  return (
    <div className="rounded-md border border-app bg-surface/60 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
          Cover pages
        </span>
        <button
          type="button"
          className="codice-bulk-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          title="Import a one-page Word document as a cover page (first page only)"
        >
          {importing ? <Loader size={10} className="animate-spin" /> : <ImagePlus size={10} />}
          Import cover (.docx)
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx"
          hidden
          aria-label="Import a cover page (.docx)"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      <p className="mb-1.5 text-[10px] text-muted">
        Codice uses the FIRST PAGE only, exactly as authored. Cover pages
        stay in your browser across sessions (up to 20) and apply to DOCX,
        PDF and ODT exports.
      </p>
      {state.coverPages.length === 0 ? (
        <p className="px-1 py-1 text-center text-[11px] text-muted">
          No cover pages yet — import a one-page .docx to use as an export's
          first page.
        </p>
      ) : (
        <ul className="space-y-1">
          {state.coverPages.map((cover) => (
            <li
              key={cover.id}
              className="flex items-center gap-1.5 rounded border border-app px-2 py-1"
            >
              {editingId === cover.id ? (
                <input
                  autoFocus
                  className="input !py-0.5 min-w-0 flex-1 text-xs"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => commitRename(cover)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(cover);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  aria-label="Cover page name"
                />
              ) : (
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-xs text-primary"
                  title="Rename cover page"
                  onClick={() => {
                    setEditingId(cover.id);
                    setEditName(cover.name);
                  }}
                >
                  {cover.name}
                </button>
              )}
              <span
                className="flex-shrink-0 text-[10px] text-muted"
                title={`${cover.fileName} · source had ${cover.pageCount} page${cover.pageCount === 1 ? '' : 's'}`}
              >
                {cover.pageCount} page{cover.pageCount === 1 ? '' : 's'}
              </span>
              {cover.truncated && (
                <span
                  className="badge flex-shrink-0 !text-[9px]"
                  title="Only the first page of the source document is used"
                >
                  first page only
                </span>
              )}
              <button
                type="button"
                className="flex-shrink-0 rounded p-0.5 text-muted hover:text-error"
                title={`Remove cover page ${cover.name}`}
                aria-label={`Remove cover page ${cover.name}`}
                onClick={() => removeCover(cover.id)}
              >
                <Trash size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* §11/§27/§43 — export groups UI: named, ordered project sets with a    */
/* per-export layout and first-page (title/cover) choice.                */
/* ------------------------------------------------------------------ */

function ExportGroupsUI({
  isExporting,
  onExportGroup,
  onExportAllGroups,
}: {
  isExporting: boolean;
  onExportGroup: (groupId: string) => void;
  /** R14 — generate every exportable group sequentially (the planner in
   * src/lib/generateAll.ts picks the ids; the parent owns the exporter). */
  onExportAllGroups: (groupIds: string[]) => void;
}) {
  const { state, dispatch, getSelectedFiles } = useAppState();
  const toast = useToastOptional();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIds, setNewIds] = useState<string[]>([]);
  /** WS-9c — group id whose inline "Add projects" picker is open, so a
   * persisted scaffold can be re-populated without recreating it. */
  const [assigningId, setAssigningId] = useState<string | null>(null);
  /** R11 — inline rename: which group is being renamed + the draft value
   * (Enter/blur commits, Escape cancels). */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  // ---- R11: group reorder (drag handle or ↑/↓ on the handle) ----------
  const dragIndex = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropHint, setDropHint] = useState<
    { index: number; below: boolean } | null
  >(null);

  // ---- R11: drag-to-assign (EXPORT-004) — sidebar project rows carry
  // 'application/x-codice-project'; group rows accept the drop. The
  // sidebar announces the gesture via window CustomEvents so the panel
  // can hint "drop a project onto a group" while a drag is in flight.
  const [projectDragActive, setProjectDragActive] = useState(false);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // R15 — the row drop-target kind: 'assign' (a sidebar project drag) vs
  // 'move' (a chip dragged from ANOTHER group). Same row can be both —
  // the visual must say WHICH semantics a drop will trigger. Declared
  // here (with its consumers' state) so the drag-event effect below can
  // clear it.
  const [dropKind, setDropKind] = useState<'assign' | 'move' | null>(null);
  useEffect(() => {
    const start = () => setProjectDragActive(true);
    const end = () => {
      setProjectDragActive(false);
      setDropTargetId(null);
      setDropKind(null);
    };
    window.addEventListener('codice-project-drag-start', start);
    window.addEventListener('codice-project-drag-end', end);
    return () => {
      window.removeEventListener('codice-project-drag-start', start);
      window.removeEventListener('codice-project-drag-end', end);
    };
  }, []);

  // ---- R14: chip reorder WITHIN a group (drag a chip or use its ↑/↓
  // buttons). Chip order = the document assembly order for that group's
  // export, so this is user-facing, not cosmetics. The payload is JSON
  // ('application/x-codice-chip') so a drop can never be mistaken for a
  // group reorder or a sidebar project assignment.
  const [chipDrag, setChipDrag] = useState<{
    groupId: string;
    index: number;
  } | null>(null);
  const [chipDropHint, setChipDropHint] = useState<{
    groupId: string;
    index: number;
    below: boolean;
  } | null>(null);

  // R15 — brief highlight of a freshly duplicated group row (see the
  // duplicate button): the new row can sit outside the viewport fold or
  // look identical to its source — the flash says "this one is new".
  const [justDuplicatedId, setJustDuplicatedId] = useState<string | null>(null);
  const duplicateFlashTimer = useRef<number | null>(null);
  const flashDuplicated = (id: string) => {
    setJustDuplicatedId(id);
    if (duplicateFlashTimer.current !== null)
      window.clearTimeout(duplicateFlashTimer.current);
    duplicateFlashTimer.current = window.setTimeout(
      () => setJustDuplicatedId(null),
      1400,
    );
  };
  useEffect(() => {
    return () => {
      if (duplicateFlashTimer.current !== null)
        window.clearTimeout(duplicateFlashTimer.current);
    };
  }, []);

  // R16 — "Move to…" strip: which chip's cross-group move menu is open
  // (one at a time — same pattern as the per-group "Add projects" strip).
  const [moveMenu, setMoveMenu] = useState<{
    groupId: string;
    projectId: string;
  } | null>(null);

  const clearChipDragState = () => {
    setChipDrag(null);
    setChipDropHint(null);
  };

  const moveChip = (groupId: string, from: number, to: number) => {
    if (from === to) return;
    dispatch({ type: 'MOVE_EXPORT_GROUP_PROJECT', groupId, from, to });
  };

  const handleChipDragStart = (
    e: React.DragEvent,
    groupId: string,
    index: number,
  ) => {
    e.dataTransfer.setData(
      'application/x-codice-chip',
      JSON.stringify({ groupId, index }),
    );
    e.dataTransfer.effectAllowed = 'move';
    setChipDrag({ groupId, index });
  };

  const handleChipDragOver = (
    e: React.DragEvent,
    groupId: string,
    index: number,
  ) => {
    if (!e.dataTransfer.types.includes('application/x-codice-chip')) return;
    // R15 — CROSS-GROUP chip drag: hovering another group's chip must light
    // up that GROUP (row-level drop target) instead of showing a within-group
    // insertion hint — a cross-group drop MOVES the project to that group, it
    // does not reorder. The row's own dragover never sees this event (the
    // chip stops propagation), so the redirect happens here.
    if (chipDrag !== null && chipDrag.groupId !== groupId) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDropTargetId((prev) => (prev === groupId ? prev : groupId));
      setDropKind((prev) => (prev === 'move' ? prev : 'move'));
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const below = e.clientY > rect.top + rect.height / 2;
    setChipDropHint((prev) =>
      prev && prev.groupId === groupId && prev.index === index && prev.below === below
        ? prev
        : { groupId, index, below },
    );
  };

  const handleChipDrop = (e: React.DragEvent, groupId: string, index: number) => {
    if (!e.dataTransfer.types.includes('application/x-codice-chip')) return;
    // R15 — CROSS-GROUP drop ON A CHIP: same semantics as dropping on the
    // group row (move = remove from the source, append to this group).
    // Handled here because the chip stops propagation — without this branch
    // a cross-group drop on the chips (the row's visual bulk) would hit the
    // chip handler and silently do nothing.
    if (chipDrag !== null && chipDrag.groupId !== groupId) {
      e.preventDefault();
      e.stopPropagation();
      const source = chipDrag.groupId;
      clearChipDragState();
      setDropTargetId(null);
      setDropKind(null);
      moveProjectBetweenGroups(source, groupId);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer.getData('application/x-codice-chip');
    // Read the dragover hint from the CLOSURE (pre-clear) — the half-point
    // side was resolved while the pointer was over this chip.
    const hint = chipDropHint;
    clearChipDragState();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { groupId?: string; index?: number };
      if (parsed.groupId !== groupId || typeof parsed.index !== 'number') return;
      const from = parsed.index;
      let to = index;
      if (from === to) return;
      // Drop BELOW the half-point targets the NEXT slot — same from<to
      // adjustment as the group reorder (the splice removes the chip
      // first, shifting the target left by one).
      const below =
        hint && hint.groupId === groupId && hint.index === index
          ? hint.below
          : false;
      if (below) to += 1;
      if (from < to) to -= 1;
      moveChip(groupId, from, to);
    } catch {
      // malformed payload — ignore (defensive; browsers only deliver
      // what this component set on dragstart)
    }
  };

  /** R15 — chip dragend also clears a cross-group row highlight: a chip
   * drag that ends WITHOUT a drop (Escape, invalid target) must not leave
   * another group's row lit as a drop target. */
  const handleChipDragEnd = () => {
    clearChipDragState();
    setDropTargetId(null);
    setDropKind(null);
  };

  /** R15 — move one project from a group to a DIFFERENT group (the
   * cross-group chip drop). Resolves the project id from FRESH state at
   * call time (the payload only carries groupId+index — same stale-snapshot
   * discipline as BUG-008), duplicate-guards for the toast, and dispatches
   * MOVE_PROJECT_BETWEEN_GROUPS (the reducer re-validates everything). */
  const moveProjectBetweenGroups = (fromGroupId: string, toGroupId: string) => {
    if (fromGroupId === toGroupId) return;
    const fromGroup = state.exportGroups.find((g) => g.id === fromGroupId);
    const toGroup = state.exportGroups.find((g) => g.id === toGroupId);
    if (!fromGroup || !toGroup) return;
    const draggedId =
      chipDrag !== null && chipDrag.groupId === fromGroupId
        ? fromGroup.projectIds[chipDrag.index]
        : undefined;
    if (!draggedId) return;
    const project = state.projects.find((p) => p.id === draggedId);
    if (toGroup.projectIds.includes(draggedId)) {
      toast?.push({
        kind: 'info',
        title: 'Already assigned',
        message: `“${project?.label ?? draggedId}” is already in “${toGroup.name}”.`,
      });
      return;
    }
    dispatch({
      type: 'MOVE_PROJECT_BETWEEN_GROUPS',
      fromGroupId,
      toGroupId,
      projectId: draggedId,
    });
    toast?.push({
      kind: 'success',
      title: 'Project moved',
      message: `Moved “${project?.label ?? draggedId}” from “${fromGroup.name}” to “${toGroup.name}” (last position).`,
    });
  };

  const activeProjects = state.projects.filter(
    (p) => getSelectedFiles(p.id).size > 0,
  );
  const appliedLayout = state.customLayouts.find(
    (t) => t.id === state.appliedLayoutId,
  );

  // R14 — which groups would "Generate all" run? Live project = uploaded
  // AND has selected files (mirrors handleExportGroup's own guard).
  const generateAllPlan = planGenerateAll(
    state.exportGroups,
    new Set(activeProjects.map((p) => p.id)),
  );

  /** Patch one group's per-export configuration (§27 layout / §43 first
   * page / cover selection). */
  const updateGroup = (group: ExportGroup, patch: Partial<ExportGroup>) =>
    dispatch({ type: 'UPDATE_EXPORT_GROUP', group: { ...group, ...patch } });

  const createGroup = () => {
    if (newIds.length === 0) return;
    dispatch({
      type: 'ADD_EXPORT_GROUP',
      group: {
        id: newGroupId(),
        name: newName.trim() || `Group ${state.exportGroups.length + 1}`,
        projectIds: newIds,
      },
    });
    setCreating(false);
    setNewName('');
    setNewIds([]);
  };

  const moveGroup = (from: number, to: number) => {
    if (from === to || to < 0 || to >= state.exportGroups.length) return;
    dispatch({ type: 'REORDER_EXPORT_GROUPS', from, to });
  };

  const clearGroupDragState = () => {
    dragIndex.current = null;
    setDraggingIndex(null);
    setDropHint(null);
  };

  /** Group-row dragover: resolves THREE drag kinds — internal reorder
   * (above/below indicator), external project assignment (drop-target
   * highlight), and R15 CROSS-GROUP chip moves (a chip dragged from a
   * different group lights the row up as a move target; a same-group chip
   * is still ignored — its own handlers own the reorder gesture). The
   * payload type decides which one runs. */
  const handleRowDragOver = (e: React.DragEvent, index: number) => {
    const groupId = state.exportGroups[index]?.id ?? null;
    if (e.dataTransfer.types.includes('application/x-codice-chip')) {
      if (chipDrag !== null && groupId !== null && chipDrag.groupId !== groupId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropTargetId((prev) => (prev === groupId ? prev : groupId));
        setDropKind((prev) => (prev === 'move' ? prev : 'move'));
      }
      return;
    }
    const isProjectDrag = e.dataTransfer.types.includes(
      'application/x-codice-project',
    );
    if (isProjectDrag) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const id = state.exportGroups[index]?.id ?? null;
      setDropTargetId((prev) => (prev === id ? prev : id));
      setDropKind((prev) => (prev === 'assign' ? prev : 'assign'));
      return;
    }
    if (dragIndex.current === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const below = e.clientY > rect.top + rect.height / 2;
    setDropHint((prev) =>
      prev && prev.index === index && prev.below === below
        ? prev
        : { index, below },
    );
  };

  /** Group-row drop: internal drag → reorder; project drag → assign; R15
   * cross-group chip drag → MOVE the project to this group (append, order
   * = arrival; duplicate-guarded with an info toast). Same-group chip
   * drops are still ignored — the chip element owns the within-group
   * reorder gesture. */
  const handleRowDrop = (e: React.DragEvent, index: number) => {
    const groupId = state.exportGroups[index]?.id ?? null;
    if (e.dataTransfer.types.includes('application/x-codice-chip')) {
      if (chipDrag !== null && groupId !== null && chipDrag.groupId !== groupId) {
        e.preventDefault();
        const source = chipDrag.groupId;
        setDropTargetId(null);
        setDropKind(null);
        setProjectDragActive(false);
        clearChipDragState();
        moveProjectBetweenGroups(source, groupId);
      }
      return;
    }
    const projectId = e.dataTransfer.getData('application/x-codice-project');
    if (projectId) {
      e.preventDefault();
      setDropTargetId(null);
      setDropKind(null);
      setProjectDragActive(false);
      const group = state.exportGroups[index];
      const project = state.projects.find((p) => p.id === projectId);
      if (!group || !project) return;
      if (group.projectIds.includes(projectId)) {
        toast?.push({
          kind: 'info',
          title: 'Already assigned',
          message: `“${project.label}” is already in “${group.name}”.`,
        });
        return;
      }
      updateGroup(group, {
        projectIds: [...group.projectIds, projectId],
      });
      toast?.push({
        kind: 'success',
        title: 'Project assigned',
        message: `Added “${project.label}” to “${group.name}”.`,
      });
      return;
    }
    // Internal reorder drop (same from/to adjustment as the sidebar).
    e.preventDefault();
    const from = dragIndex.current;
    const hint = dropHint;
    clearGroupDragState();
    if (from === null || !hint) return;
    let to = hint.below ? hint.index + 1 : hint.index;
    if (from < to) to -= 1;
    moveGroup(from, to);
  };

  const commitRename = (group: ExportGroup) => {
    const next = renameDraft.trim();
    if (renamingId !== group.id) return;
    if (next && next !== group.name) {
      updateGroup(group, { name: next });
    }
    setRenamingId(null);
  };

  return (
    <div className="rounded-md border border-app bg-surface/60 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
          Export groups
        </span>
        <div className="flex items-center gap-1">
          {/* R14 — one click runs every exportable group sequentially
              (empty groups are skipped and counted, not warned per-row). */}
          {generateAllPlan.ids.length > 0 && (
            <button
              type="button"
              className="codice-bulk-btn codice-generate-all-btn"
              disabled={isExporting}
              title={
                isExporting
                  ? 'Wait for the current export to finish'
                  : `Generate all ${generateAllPlan.ids.length} group${generateAllPlan.ids.length === 1 ? '' : 's'} in order${generateAllPlan.skipped > 0 ? ` (${generateAllPlan.skipped} empty skipped)` : ''}`
              }
              aria-label={`Generate all ${generateAllPlan.ids.length} group${generateAllPlan.ids.length === 1 ? '' : 's'}${generateAllPlan.skipped > 0 ? `, skipping ${generateAllPlan.skipped} empty` : ''}`}
              onClick={() => onExportAllGroups(generateAllPlan.ids)}
            >
              <Play size={10} /> Generate all
            </button>
          )}
          <button
            type="button"
            className="codice-bulk-btn"
            onClick={() => setCreating((v) => !v)}
            aria-expanded={creating}
          >
            <Plus size={10} /> New group
          </button>
        </div>
      </div>

      {/* R11 — live affordance while a sidebar project is being dragged:
          the drop targets announce themselves instead of the user having
          to know drop-on-row works. */}
      {projectDragActive && (
        <p className="codice-groups-hint mb-1.5 rounded border border-dashed px-1.5 py-1 text-[10px]">
          Drop the project onto a group to assign it — click order = document
          order.
        </p>
      )}

      {creating && (
        <div className="mb-2 space-y-1.5 rounded border border-dashed border-app p-2">
          <input
            type="text"
            className="input"
            placeholder="Group name (e.g. A + C)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            aria-label="Group name"
          />
          <div className="flex flex-wrap gap-1">
            {activeProjects.map((p) => {
              const idx = newIds.indexOf(p.id);
              const on = idx !== -1;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`codice-input-chip ${on ? '!border-[var(--color-accent)] !text-primary' : ''}`}
                  title={on ? `Remove ${p.label} from the group` : `Add ${p.label} to the group (order = click order)`}
                  aria-pressed={on}
                  onClick={() =>
                    setNewIds((ids) =>
                      on ? ids.filter((x) => x !== p.id) : [...ids, p.id],
                    )
                  }
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="btn-primary !px-2 !py-1 text-[11px]"
              onClick={createGroup}
              disabled={newIds.length === 0}
            >
              Create group ({newIds.length})
            </button>
            <span className="text-[10px] text-muted">
              click projects in the order they should appear in the document
            </span>
          </div>
        </div>
      )}

      {state.exportGroups.length === 0 && !creating && (
        <div className="codice-groups-empty" role="status">
          <Layers size={16} aria-hidden="true" />
          <p className="text-[11px] font-semibold">No export groups yet</p>
          <p className="text-[10px] leading-relaxed">
            Create one (e.g. “A + C”) and generate exactly that combination —
            a project may belong to any number of groups.
          </p>
          <button
            type="button"
            className="codice-bulk-btn"
            onClick={() => setCreating(true)}
          >
            <Plus size={10} /> Create a group
          </button>
        </div>
      )}

      <ul className="space-y-1.5">
        {state.exportGroups.map((group, index) => {
          // WS-9c — a persisted scaffold may reference no live projects
          // (uploads are session-scoped); keep the row visible but inert.
          const liveProjectIds = group.projectIds.filter((pid) =>
            state.projects.some((p) => p.id === pid),
          );
          const showAbove =
            dropHint !== null && dropHint.index === index && !dropHint.below;
          const showBelow =
            dropHint !== null && dropHint.index === index && dropHint.below;
          return (
          <li
            key={group.id}
            className={`codice-group-row group-row group relative overflow-hidden rounded-md border transition-all duration-150 ${
              dropTargetId === group.id
                ? 'codice-group-drop-target'
                : 'border-app hover:border-[var(--color-text-muted)]'
            } ${draggingIndex === index ? 'codice-row-dragging' : ''} ${
              showAbove ? 'codice-drop-above' : ''
            } ${showBelow ? 'codice-drop-below' : ''} ${
              justDuplicatedId === group.id ? 'codice-row-flash' : ''
            }`}
            data-drop-kind={dropTargetId === group.id ? dropKind : undefined}
            draggable={false}
            onDragOver={(e) => handleRowDragOver(e, index)}
            onDrop={(e) => handleRowDrop(e, index)}
          >
            <div className="px-2 pt-1.5">
              {/* R11 — row A: reorder handle + position badge + name +
                  rename pencil. Generate/delete live on row B (a 170px
                  panel cannot fit six controls on one line — the first
                  cut squeezed the name to zero width, caught in live QA). */}
              <div className="flex items-center gap-1">
                {/* Reorder handle: drag to move the group (order = the row
                    order = the persisted scaffold order), or focus and
                    press ↑/↓. */}
                <button
                  type="button"
                  className="codice-drag-handle flex-shrink-0"
                  title={`Drag to reorder — or focus and press ↑/↓ (position ${index + 1})`}
                  aria-label={`Reorder export group ${group.name}. Currently position ${index + 1}. Press ArrowUp or ArrowDown to move.`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(index));
                    dragIndex.current = index;
                    setDraggingIndex(index);
                  }}
                  onDragEnd={clearGroupDragState}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      moveGroup(index, index - 1);
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      moveGroup(index, index + 1);
                    }
                  }}
                  onClick={(e) => e.preventDefault()}
                >
                  <GripVertical size={12} />
                </button>
                <span
                  className="flex-shrink-0 rounded bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-[var(--color-accent)]"
                  title="Export files generate in this row order"
                >
                  Export {index + 1}
                </span>
                {renamingId === group.id ? (
                  <input
                    type="text"
                    className="input min-w-0 flex-1 !py-0.5 text-xs"
                    value={renameDraft}
                    autoFocus
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => commitRename(group)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(group);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    aria-label={`Rename group (was ${group.name})`}
                  />
                ) : (
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-xs font-medium text-primary transition-colors hover:text-[var(--color-accent)]"
                    title={`${group.name} — double-click or use the pencil to rename`}
                    onDoubleClick={() => {
                      setRenameDraft(group.name);
                      setRenamingId(group.id);
                    }}
                  >
                    {group.name}
                  </button>
                )}
                <button
                  type="button"
                  className="codice-rename-btn flex-shrink-0"
                  title={`Duplicate group ${group.name}`}
                  aria-label={`Duplicate group ${group.name}`}
                  onClick={() => {
                    // R15 — the id is generated HERE (not in the reducer) so
                    // the new row can be flashed (BUG-008 discipline: the
                    // action payload carries it; the reducer still validates
                    // the source and re-generates when absent).
                    const freshId = newGroupId();
                    flashDuplicated(freshId);
                    dispatch({ type: 'DUPLICATE_EXPORT_GROUP', id: group.id, newId: freshId });
                  }}
                >
                  <Copy size={11} />
                </button>
                <button
                  type="button"
                  className="codice-rename-btn flex-shrink-0"
                  title={`Rename group ${group.name}`}
                  aria-label={`Rename group ${group.name}`}
                  onClick={() => {
                    setRenameDraft(group.name);
                    setRenamingId(group.id);
                  }}
                >
                  <Pencil size={11} />
                </button>
              </div>
              {/* Row B: the group's own Generate + delete. */}
              <div className="mt-1.5 flex items-center gap-1">
                <button
                  type="button"
                  className="btn-primary min-w-0 flex-1 truncate !py-1 text-[11px]"
                  onClick={() => onExportGroup(group.id)}
                  disabled={isExporting || liveProjectIds.length === 0}
                  title={
                    liveProjectIds.length === 0
                      ? `Assign projects to “${group.name}” first — upload projects, then drag or click them into the group`
                      : `Generate one document with exactly: ${group.projectIds
                          .map((id) => state.projects.find((p) => p.id === id)?.label ?? '?')
                          .join(' + ')}`
                  }
                >
                  Generate
                </button>
                <button
                  type="button"
                  className="flex-shrink-0 rounded p-0.5 text-muted transition-colors hover:text-error"
                  title={`Delete group ${group.name}`}
                  aria-label={`Delete group ${group.name}`}
                  onClick={() => dispatch({ type: 'DELETE_EXPORT_GROUP', id: group.id })}
                >
                  <Trash size={11} />
                </button>
              </div>
            </div>
            {/* §27 — per-export layout: fixed shared text, or a per-group
                template choice when "same layout for all exports" is off.
                R11: grid rows with an aligned label column — no more
                truncated "Follow p…" / "stan…" selects. */}
            <div className="mt-1.5 grid grid-cols-[54px_1fr] items-center gap-x-1.5 gap-y-1 px-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                Layout
              </span>
              {state.sameLayoutForAllExports ? (
                <span
                  className="min-w-0 truncate text-[11px] text-secondary"
                  title="Every export uses the layout applied in the Layout studio (or the standard flow when none is applied)"
                >
                  Shared layout: {appliedLayout?.name ?? 'standard flow'}
                </span>
              ) : (
                <select
                  className="select !py-0.5 min-w-0 text-[11px]"
                  value={group.layoutId ?? ''}
                  onChange={(e) =>
                    updateGroup(group, { layoutId: e.target.value || null })
                  }
                  aria-label={`Layout for ${group.name}`}
                  title="This export's own layout template — or the shared applied layout"
                >
                  <option value="">Use shared layout</option>
                  {state.customLayouts.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
              {/* §43 — first page: follow the preset, force the generated
                  title page on, or prepend an imported cover page (DOCX,
                  PDF and ODT). */}
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                First pg
              </span>
              <select
                className="select !py-0.5 min-w-0 text-[11px]"
                value={group.firstPage ?? 'preset'}
                onChange={(e) =>
                  updateGroup(group, {
                    firstPage: e.target.value as 'preset' | 'title' | 'cover',
                  })
                }
                aria-label={`First page for ${group.name}`}
                title="Title page and cover page are mutually exclusive — the cover becomes page 1 (DOCX, PDF and ODT exports)"
              >
                <option value="preset">Follow preset</option>
                <option value="title">Title page</option>
                <option value="cover">Cover page</option>
              </select>
              {(group.firstPage ?? 'preset') === 'cover' && (
                <>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                    Cover
                  </span>
                  <select
                    className="select !py-0.5 min-w-0 text-[11px]"
                    value={group.coverId ?? ''}
                    onChange={(e) =>
                      updateGroup(group, { coverId: e.target.value || undefined })
                    }
                    aria-label={`Cover page for ${group.name}`}
                    title="Which imported cover page to prepend (DOCX, PDF and ODT exports)"
                  >
                    {state.coverPages.length === 0 ? (
                      <option value="" disabled>
                        No covers — import above
                      </option>
                    ) : (
                      <>
                        <option value="">Choose a cover…</option>
                        {state.coverPages.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </>
              )}
              {/* R12 — per-group output filename override. Empty = the
                  default `{global filename}_{group name}` (shown as the
                  placeholder so the fallback is always visible). */}
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                File name
              </span>
              <input
                type="text"
                className="input !py-0.5 min-w-0 text-[11px]"
                defaultValue={group.filename ?? ''}
                placeholder={groupExportFilename(
                  { name: group.name },
                  state.outputFilename || 'Codice_Output',
                )}
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim();
                  if (v !== (group.filename ?? '')) {
                    updateGroup(group, { filename: v || undefined });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                aria-label={`Output filename for ${group.name}`}
                title="Optional — rename this export's file. Tokens: {title} = the export filename above, {group} = this group's name, {date} = today. Empty = default."
              />
            </div>
            <div className="mt-1 flex flex-wrap gap-1 px-2">
              {group.projectIds.map((pid, i) => {
                const project = state.projects.find((p) => p.id === pid);
                if (!project) return null;
                const rawIndex = i;
                const liveIndex = liveProjectIds.indexOf(pid);
                const chipDragging =
                  chipDrag !== null &&
                  chipDrag.groupId === group.id &&
                  chipDrag.index === i;
                const chipAbove =
                  chipDropHint !== null &&
                  chipDropHint.groupId === group.id &&
                  chipDropHint.index === i &&
                  !chipDropHint.below;
                const chipBelow =
                  chipDropHint !== null &&
                  chipDropHint.groupId === group.id &&
                  chipDropHint.index === i &&
                  chipDropHint.below;
                return (
                  <span
                    key={pid}
                    className={`codice-chip ${chipDragging ? 'codice-chip-dragging' : ''} ${chipAbove ? 'codice-chip-drop-above' : ''} ${chipBelow ? 'codice-chip-drop-below' : ''}`}
                    title={`Position ${i + 1} — drag to reorder (order = document assembly order); drag onto ANOTHER group to move it there`}
                    draggable
                    onDragStart={(e) => handleChipDragStart(e, group.id, i)}
                    onDragOver={(e) => handleChipDragOver(e, group.id, i)}
                    onDrop={(e) => handleChipDrop(e, group.id, i)}
                    onDragEnd={handleChipDragEnd}
                    data-testid={`group-chip-${group.id}-${pid}`}
                  >
                    <span className="text-muted tabular-nums">
                      {/* R14 — number by LIVE position: ids whose project
                          vanished (removed while assigned) are skipped by
                          the renderer but would otherwise leave gaps in
                          the 1..N numbering. */}
                      {liveProjectIds.indexOf(pid) + 1}
                    </span>
                    {project.label}
                    {/* R14 — keyboard/mouse reorder: quiet ↑/↓ revealed on
                        chip hover or focus (same pattern as the rename
                        pencil); the reducer guards every move. The buttons
                        move within the LIVE list and translate to raw
                        indices, so an invisible dead id can never swallow
                        a move (it would otherwise look like a no-op). */}
                    <button
                      type="button"
                      className="codice-chip-btn"
                      title={`Move ${project.label} one position up`}
                      aria-label={`Move ${project.label} up in ${group.name}`}
                      disabled={liveIndex <= 0}
                      onClick={() =>
                        moveChip(
                          group.id,
                          rawIndex,
                          group.projectIds.indexOf(liveProjectIds[liveIndex - 1]),
                        )
                      }
                    >
                      <ChevronUp size={9} />
                    </button>
                    <button
                      type="button"
                      className="codice-chip-btn"
                      title={`Move ${project.label} one position down`}
                      aria-label={`Move ${project.label} down in ${group.name}`}
                      disabled={liveIndex >= liveProjectIds.length - 1}
                      onClick={() =>
                        moveChip(
                          group.id,
                          rawIndex,
                          group.projectIds.indexOf(liveProjectIds[liveIndex + 1]),
                        )
                      }
                    >
                      <ChevronDown size={9} />
                    </button>
                    {/* R16 — keyboard/mouse cross-group move: opens the
                        "Move to…" strip below the chips (the drag gesture's
                        accessible twin — same dispatch, same guards). */}
                    <button
                      type="button"
                      className="codice-chip-btn"
                      title={
                        state.exportGroups.length < 2
                          ? 'Create another group to move this project to'
                          : `Move ${project.label} to another group…`
                      }
                      aria-label={`Move ${project.label} to another group`}
                      aria-expanded={
                        moveMenu?.groupId === group.id &&
                        moveMenu?.projectId === pid
                      }
                      disabled={state.exportGroups.length < 2}
                      onClick={() =>
                        setMoveMenu(
                          moveMenu?.groupId === group.id && moveMenu?.projectId === pid
                            ? null
                            : { groupId: group.id, projectId: pid },
                        )
                      }
                    >
                      <ChevronRight size={9} />
                    </button>
                    <button
                      type="button"
                      className="text-muted hover:text-error"
                      title={`Remove ${project.label} from group`}
                      aria-label={`Remove ${project.label} from group`}
                      onClick={() =>
                        dispatch({
                          type: 'UPDATE_EXPORT_GROUP',
                          group: {
                            ...group,
                            projectIds: group.projectIds.filter((x) => x !== pid),
                          },
                        })
                      }
                    >
                      <X size={9} />
                    </button>
                  </span>
                );
              })}
              {liveProjectIds.length === 0 && (
                <span
                  className="text-[10px] italic text-muted"
                  title="Groups persist across sessions — upload projects, then drag or click them into this group to re-assign"
                >
                  No projects assigned — upload projects, then drag a project
                  row here (or use Add projects). Groups persist across
                  sessions.
                </span>
              )}
            </div>
            {/* R16 — "Move to…" strip (one open at a time, same inline-strip
                pattern as "Add projects"): the accessible twin of the
                cross-group chip drag — pick a target group, the reducer
                runs the exact same MOVE_PROJECT_BETWEEN_GROUPS guard set. */}
            {moveMenu?.groupId === group.id &&
              (() => {
                const moving = state.projects.find(
                  (p) => p.id === moveMenu.projectId,
                );
                const targets = state.exportGroups.filter(
                  (g) => g.id !== group.id,
                );
                if (!moving || targets.length === 0) return null;
                return (
                  <div
                    className="codice-move-strip mt-1 flex flex-wrap items-center gap-1 px-2 py-1"
                    role="group"
                    aria-label={`Choose a group to move ${moving.label} into`}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setMoveMenu(null);
                      }
                    }}
                  >
                    <span className="text-[10px] text-muted">
                      Move“{moving.label}”to:
                    </span>
                    {targets.map((target) => (
                      <button
                        key={target.id}
                        type="button"
                        className="codice-input-chip codice-move-target"
                        aria-pressed={false}
                        autoFocus
                        title={
                          target.projectIds.includes(moveMenu.projectId)
                            ? `“${moving.label}” is already in “${target.name}”`
                            : `Move to ${target.name} (it becomes the last document section there)`
                        }
                        disabled={target.projectIds.includes(moveMenu.projectId)}
                        onClick={() => {
                          const fromGroup = state.exportGroups.find(
                            (g) => g.id === group.id,
                          );
                          if (!fromGroup) return;
                          if (target.projectIds.includes(moveMenu.projectId)) {
                            toast?.push({
                              kind: 'info',
                              title: 'Already assigned',
                              message: `“${moving.label}” is already in “${target.name}”.`,
                            });
                            return;
                          }
                          dispatch({
                            type: 'MOVE_PROJECT_BETWEEN_GROUPS',
                            fromGroupId: group.id,
                            toGroupId: target.id,
                            projectId: moveMenu.projectId,
                          });
                          toast?.push({
                            kind: 'success',
                            title: 'Project moved',
                            message: `Moved “${moving.label}” from “${fromGroup.name}” to “${target.name}” (last position).`,
                          });
                          setMoveMenu(null);
                        }}
                      >
                        {target.name}
                      </button>
                    ))}
                  </div>
                );
              })()}
            {/* R16 — live summary of what this group's export would contain
                (live projects with selected files only — same guard the
                Generate button uses). Hidden while the row is empty (the
                empty-state message above covers that case). */}
            {liveProjectIds.length > 0 &&
              (() => {
                const summary = summarizeGroup(
                  group.projectIds,
                  state.projects,
                  getSelectedFiles,
                );
                if (summary.projects === 0) return null;
                return (
                  <div className="codice-group-summary" aria-live="polite">
                    {summary.projects} project{summary.projects === 1 ? '' : 's'}
                    {' · '}
                    {summary.files} file{summary.files === 1 ? '' : 's'}
                    {' · '}
                    {formatSize(summary.bytes)}
                  </div>
                );
              })()}
            {/* WS-9c — append projects to an EXISTING group (order = click
                order); the affordance a persisted scaffold needs. */}
            <div className="mt-1 flex flex-wrap items-center gap-1 px-2 pb-1.5">
              <button
                type="button"
                className="codice-bulk-btn !px-1.5 !py-0.5 text-[10px]"
                aria-expanded={assigningId === group.id}
                onClick={() =>
                  setAssigningId(assigningId === group.id ? null : group.id)
                }
              >
                <Plus size={9} /> Add projects
              </button>
              {assigningId === group.id &&
                activeProjects
                  .filter((p) => !group.projectIds.includes(p.id))
                  .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="codice-input-chip"
                      aria-pressed={false}
                      title={`Append ${p.label} (order = click order)`}
                      onClick={() =>
                        updateGroup(group, {
                          projectIds: [...group.projectIds, p.id],
                        })
                      }
                    >
                      {p.label}
                    </button>
                  ))}
              {assigningId === group.id &&
                activeProjects.every((p) => group.projectIds.includes(p.id)) && (
                  <span className="text-[10px] text-muted">
                    every active project is already in this group
                  </span>
                )}
            </div>
          </li>
          );
        })}
      </ul>
    </div>
  );
}
