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

  /** Build a DocumentModel for a single project. */
  const buildProjectModel = useCallback(
    async (
      project: ProjectEntry,
      onProgress?: (done: number, total: number, currentPath?: string) => void,
    ): Promise<DocumentModel> => {
      const selectedFileIds = getSelectedFiles(project.id);
      return buildDocumentModel(
        [{ project, selectedFileIds }],
        presetToOptions(state.preset),
        state.metadata,
        onProgress,
      );
    },
    [state.preset, state.metadata, getSelectedFiles],
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

    const activeProjects = state.projects.filter(
      (p) => getSelectedFiles(p.id).size > 0,
    );

    // Separate mode shows what the archive will contain before building it.
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
        }));
        const model = await buildDocumentModel(
          projectInputs,
          presetToOptions(state.preset),
          state.metadata,
          watchCancel,
        );
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
  ]);

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
            </select>
          </div>
        </div>
      </div>

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
            disabled={isExporting || totalSelected === 0}
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
