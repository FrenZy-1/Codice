/**
 * Export panel — orchestrates the export pipeline.
 *
 * Supports two output modes when multiple projects are present:
 *   - combined: all projects in one document
 *   - separate: one document per project, packaged into a ZIP
 *
 * Uses the toast system for success/error notifications.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppState, type OutputMode } from '@/hooks/useAppState';
import { useToast } from '@/components/common/Toast';
import { buildDocumentModel } from '@/lib/documentBuilder';
import { getExporter, runExport } from '@/lib/exporters';
import { presetToOptions } from '@/lib/presets/presetToOptions';
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
import type { DocumentModel, ExportResult, ProjectEntry } from '@/types';
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
  Trash,
  Package,
  Check,
  ImagePlus,
  Plus,
} from '@/components/common/Icons';

/** Sentinel error used to unwind the export pipeline on user cancel. */
class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'ExportCancelled';
  }
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
  const [history, setHistory] = useState<ExportHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<ExportHistoryEntry[]>([]);
  historyRef.current = history;
  useEffect(() => {
    return () => {
      clearHistory(historyRef.current);
    };
  }, []);

  // ---- Archive preview dialog (Source ZIP / separate-mode export) ----
  const [archivePreview, setArchivePreview] = useState<
    { kind: 'snapshot' | 'separate'; entries: ArchivePreviewEntry[] } | null
  >(null);

  const totalSelected = state.projects.reduce(
    (acc, p) => acc + getSelectedFiles(p.id).size,
    0,
  );

  /** Build a DocumentModel for a single project — including per-file user
   * content (details/images, §6-§12) and the resolved custom layout (§32). */
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
      state.projectFieldValues,
      state.documentFieldValues,
      getSelectedFiles,
    ],
  );

  /** Resolve the applied layout against a built model's projects (§17). */
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
        fileOrder: state.fileOrder,
        assignments: state.layoutAssignments,
        imageAssets: Object.fromEntries(state.imageAssets.map((a) => [a.id, a])),
        metadata: state.metadata,
        fileCount: projects.reduce((acc, p) => acc + p.files.length, 0),
      };
      return resolveCustomLayout(template, inputs);
    },
    [
      state.fileDetails,
      state.fileFieldValues,
      state.sectionFieldValues,
      state.fileOrder,
      state.layoutAssignments,
      state.imageAssets,
      state.metadata,
    ],
  );

  /** §5 — required-field validation BEFORE any export work. Returns true
   * (and shows the error toast) when the export must be blocked. Works
   * through the actual resolved layout/data pipeline — never a hardcoded
   * field list — and identifies the section/block/file that failed. */
  const validateBeforeExport = useCallback(
    (projects: ProjectEntry[]): boolean => {
      const appliedLayout = state.customLayouts.find(
        (t) => t.id === state.appliedLayoutId,
      );
      if (!appliedLayout) return false;
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
        template: appliedLayout,
        projects: docProjects,
        fileDetails: state.fileDetails,
        fileFieldValues: state.fileFieldValues,
        sectionFieldValues: state.sectionFieldValues,
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
        template: appliedLayout,
        projects: docProjects,
        fileDetails: state.fileDetails,
        fileFieldValues: state.fileFieldValues,
        sectionFieldValues: state.sectionFieldValues,
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

  /** Sanitize a string for use as a filename. */
  function sanitizeFilename(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/^[._-]+/, '')
      .replace(/[._-]+$/, '')
      .slice(0, 100) || 'output';
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

    const activeProjects = state.projects.filter(
      (p) => getSelectedFiles(p.id).size > 0,
    );

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

      // Determine which projects have selected files.
      const activeProjects = state.projects.filter(
        (p) => getSelectedFiles(p.id).size > 0,
      );

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
    state.projectFieldValues,
    state.documentFieldValues,
    validateBeforeExport,
    resolveForModel,
  ]);

  /** Export exactly the projects of ONE export group as a single combined
   * document (§11 — arbitrary project combinations; a project may belong
   * to any number of groups). */
  const handleExportGroup = useCallback(
    async (groupId: string) => {
      const group = state.exportGroups.find((g) => g.id === groupId);
      if (!group) return;
      const groupProjects = state.projects.filter(
        (p) => group.projectIds.includes(p.id) && getSelectedFiles(p.id).size > 0,
      );
      if (groupProjects.length === 0) {
        toast.push({
          kind: 'warning',
          title: 'Empty group',
          message: `“${group.name}” has no projects with selected files.`,
        });
        return;
      }
      // §5 — validation scoped to exactly the group's projects.
      if (validateBeforeExport(groupProjects)) return;

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
        const appliedLayout = state.customLayouts.find(
          (t) => t.id === state.appliedLayoutId,
        );
        if (appliedLayout) {
          model.customLayout = resolveForModel(appliedLayout, model.projects);
        }
        setProgress({
          phase: `Exporting “${group.name}” to ${state.outputFormat.toUpperCase()}`,
          done: 0,
          total: 0,
        });
        const base = state.outputFilename || 'Codice_Output';
        const result = await runExport(exporter, model, {
          format: state.outputFormat,
          filename: `${base}_${sanitizeFilename(group.name)}`,
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
      } finally {
        setIsExporting(false);
        setProgress(null);
      }
    },
    [
      state.exportGroups,
      state.projects,
      state.outputFormat,
      state.outputFilename,
      state.preset,
      state.metadata,
      state.fileOrder,
      state.fileDetails,
      state.fileImages,
      state.imageAssets,
      state.customLayouts,
      state.appliedLayoutId,
      getSelectedFiles,
      toast,
      validateBeforeExport,
      resolveForModel,
      watchCancel,
    ],
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

  const showModeToggle = state.projects.filter(
    (p) => getSelectedFiles(p.id).size > 0,
  ).length > 1;

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
              value={showModeToggle ? state.outputMode : 'combined'}
              onChange={(e) =>
                dispatch({
                  type: 'SET_OUTPUT_MODE',
                  mode: e.target.value as OutputMode,
                })
              }
              disabled={!showModeToggle}
              title={
                showModeToggle
                  ? 'Choose how to package multiple projects'
                  : 'Only available with multiple projects selected'
              }
            >
              <option value="combined">Combined (single document)</option>
              <option value="separate">Separate (ZIP archive)</option>
              <option value="groups">Export groups (arbitrary sets)</option>
            </select>
          </div>
        </div>
      </div>

      {/* §11 — export groups: named, ordered project sets; each exports as
          one document and a project may belong to any number of groups. */}
      {showModeToggle && state.outputMode === 'groups' && (
        <ExportGroupsUI
          isExporting={isExporting}
          onExportGroup={(id) => void handleExportGroup(id)}
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
              ? `${state.projects.filter(p => getSelectedFiles(p.id).size > 0).length} projects → 1 document`
              : `${state.projects.filter(p => getSelectedFiles(p.id).size > 0).length} projects → ZIP archive`
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
              (showModeToggle && state.outputMode === 'groups')
            }
            title={
              showModeToggle && state.outputMode === 'groups'
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
              title="Clear history (frees memory)"
              className="ml-auto rounded p-0.5 text-muted transition-colors hover:text-error"
              onClick={(e) => {
                e.stopPropagation();
                setHistory((prev) => clearHistory(prev));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  e.preventDefault();
                  setHistory((prev) => clearHistory(prev));
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
        <span className="badge">{appliedLayout.sections.length} sections</span>
      </button>
      {open && (
        <div id="codice-layout-fields" className="codice-fade-in space-y-2 border-t border-app p-2">
          {appliedLayout.sections.length === 0 && (
            <p className="text-[11px] text-muted">
              This template has no sections.
            </p>
          )}
          {appliedLayout.sections.map((section) => {
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
/* §11 — export groups UI: named, ordered project sets                  */
/* ------------------------------------------------------------------ */

function ExportGroupsUI({
  isExporting,
  onExportGroup,
}: {
  isExporting: boolean;
  onExportGroup: (groupId: string) => void;
}) {
  const { state, dispatch, getSelectedFiles } = useAppState();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIds, setNewIds] = useState<string[]>([]);

  const activeProjects = state.projects.filter(
    (p) => getSelectedFiles(p.id).size > 0,
  );

  const createGroup = () => {
    if (newIds.length === 0) return;
    dispatch({
      type: 'ADD_EXPORT_GROUP',
      group: {
        id: `grp-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
        name: newName.trim() || `Group ${state.exportGroups.length + 1}`,
        projectIds: newIds,
      },
    });
    setCreating(false);
    setNewName('');
    setNewIds([]);
  };

  return (
    <div className="rounded-md border border-app bg-surface/60 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
          Export groups
        </span>
        <button
          type="button"
          className="codice-bulk-btn"
          onClick={() => setCreating((v) => !v)}
          aria-expanded={creating}
        >
          <Plus size={10} /> New group
        </button>
      </div>

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
        <p className="px-1 py-2 text-center text-[11px] text-muted">
          No groups yet — create one (e.g. “A + C”) and generate exactly that
          combination. A project may belong to any number of groups.
        </p>
      )}

      <ul className="space-y-1.5">
        {state.exportGroups.map((group) => (
          <li key={group.id} className="rounded border border-app px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-primary">
                {group.name}
              </span>
              <button
                type="button"
                className="btn-primary !px-2 !py-1 text-[11px]"
                onClick={() => onExportGroup(group.id)}
                disabled={isExporting}
                title={`Generate one document with exactly: ${group.projectIds
                  .map((id) => state.projects.find((p) => p.id === id)?.label ?? '?')
                  .join(' + ')}`}
              >
                Generate
              </button>
              <button
                type="button"
                className="rounded p-0.5 text-muted hover:text-error"
                title={`Delete group ${group.name}`}
                aria-label={`Delete group ${group.name}`}
                onClick={() => dispatch({ type: 'DELETE_EXPORT_GROUP', id: group.id })}
              >
                <Trash size={11} />
              </button>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {group.projectIds.map((pid, i) => {
                const project = state.projects.find((p) => p.id === pid);
                if (!project) return null;
                return (
                  <span
                    key={pid}
                    className="flex items-center gap-1 rounded border border-app px-1.5 py-0.5 text-[10px] text-secondary"
                  >
                    <span className="text-muted tabular-nums">{i + 1}</span>
                    {project.label}
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
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
