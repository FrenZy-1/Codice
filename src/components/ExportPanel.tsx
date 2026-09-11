/**
 * Export panel — orchestrates the export pipeline.
 *
 * Supports two output modes when multiple projects are present:
 *   - combined: all projects in one document
 *   - separate: one document per project, packaged into a ZIP
 *
 * Uses the toast system for success/error notifications.
 */

import { useCallback, useState } from 'react';
import { useAppState, type OutputMode } from '@/hooks/useAppState';
import { useToast } from '@/components/common/Toast';
import { buildDocumentModel } from '@/lib/documentBuilder';
import { getExporter, runExport } from '@/lib/exporters';
import { presetToOptions } from '@/lib/presets/presetToOptions';
import type { DocumentModel, ExportResult, ProjectEntry } from '@/types';
import JSZip from 'jszip';
import { Download, Loader } from '@/components/common/Icons';

export function ExportPanel() {
  const { state, dispatch, getSelectedFiles } = useAppState();
  const toast = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<{
    phase: string;
    done: number;
    total: number;
    currentPath?: string;
  } | null>(null);

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
      .replace(/^_+|_+$/g, '')
      .slice(0, 100) || 'output';
  }

  const handleExport = useCallback(async () => {
    if (state.projects.length === 0 || totalSelected === 0) {
      toast.push({
        kind: 'warning',
        title: 'No files selected',
        message: 'Add a project and select files before exporting.',
      });
      return;
    }

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
          (done, total, currentPath) =>
            setProgress({
              phase: 'Highlighting files',
              done,
              total,
              currentPath,
            }),
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
        for (const project of activeProjects) {
          setProgress({
            phase: `Processing ${project.label}`,
            done: count,
            total: activeProjects.length,
          });
          const model = await buildProjectModel(project, (done, total, currentPath) =>
            setProgress({
              phase: `Highlighting ${project.label}`,
              done,
              total,
              currentPath,
            }),
          );
          setProgress({
            phase: `Exporting ${project.label}`,
            done: count,
            total: activeProjects.length,
          });
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
        toast.dismiss(loadingToastId);
        toast.push({
          kind: 'success',
          title: `${activeProjects.length} documents packaged`,
          message: `${zipName} · ${(zipBlob.size / 1024).toFixed(1)} KB · ${Math.round(totalMs)}ms total`,
        });
      }
    } catch (err) {
      toast.dismiss(loadingToastId);
      toast.push({
        kind: 'error',
        title: 'Export failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        durationMs: 10000,
      });
    } finally {
      setIsExporting(false);
      setProgress(null);
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
  ]);

  const showModeToggle = state.projects.filter(
    (p) => getSelectedFiles(p.id).size > 0,
  ).length > 1;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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

      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted">
          {showModeToggle
            ? state.outputMode === 'combined'
              ? `${state.projects.filter(p => getSelectedFiles(p.id).size > 0).length} projects → 1 document`
              : `${state.projects.filter(p => getSelectedFiles(p.id).size > 0).length} projects → ZIP archive`
            : `${totalSelected} file${totalSelected === 1 ? '' : 's'} selected`}
        </div>
        <button
          className="btn-primary"
          onClick={handleExport}
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

      {progress && (
        <div className="rounded-md border border-app bg-surface p-2">
          <div className="flex items-center gap-2 text-xs text-secondary">
            <Loader size={12} className="animate-spin" />
            <span>{progress.phase}…</span>
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
        </div>
      )}
    </div>
  );
}
