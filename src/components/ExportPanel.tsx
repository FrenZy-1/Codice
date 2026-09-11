/**
 * Export panel — orchestrates the export pipeline.
 *
 * Builds the DocumentModel and runs the configured exporter. Shows progress
 * and surfaces any errors. The generated blob is offered as a download.
 */

import { useCallback, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { buildDocumentModel } from '@/lib/documentBuilder';
import { getExporter, runExport } from '@/lib/exporters';
import type { DocumentModel, ExportResult } from '@/types';
import { Download, Loader, AlertTriangle, Check } from '@/components/common/Icons';

interface Props {
  onExported?: (result: ExportResult) => void;
}

export function ExportPanel({ onExported }: Props) {
  const { state, dispatch, getSelectedFiles } = useAppState();
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<{
    phase: string;
    done: number;
    total: number;
    currentPath?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ExportResult | null>(null);

  const totalSelected = state.projects.reduce((acc, p) => {
    return acc + getSelectedFiles(p.id).size;
  }, 0);

  const handleExport = useCallback(async () => {
    if (state.projects.length === 0 || totalSelected === 0) {
      setError('No files selected to export.');
      return;
    }
    setIsExporting(true);
    setError(null);
    setLastResult(null);
    setProgress({ phase: 'Building document model', done: 0, total: 0 });

    try {
      const projectInputs = state.projects.map((project) => ({
        project,
        selectedFileIds: getSelectedFiles(project.id),
      }));

      const model: DocumentModel = await buildDocumentModel(
        projectInputs,
        state.options,
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

      const exporter = getExporter(state.outputFormat);
      const result = await runExport(exporter, model, {
        format: state.outputFormat,
        filename: state.outputFilename || 'codedoc-document',
      });

      setLastResult(result);
      onExported?.(result);

      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
      setProgress(null);
    }
  }, [
    state.projects,
    state.options,
    state.metadata,
    state.outputFormat,
    state.outputFilename,
    totalSelected,
    getSelectedFiles,
    onExported,
  ]);

  return (
    <div className="space-y-3">
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
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="label block mb-1">Output format</label>
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
        <button
          className="btn-primary"
          onClick={handleExport}
          disabled={isExporting || totalSelected === 0}
        >
          {isExporting ? (
            <>
              <Loader size={14} className="animate-spin" />
              Exporting…
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
        <div className="rounded-md border border-[#30363d] bg-[#161b22] p-2">
          <div className="flex items-center gap-2 text-xs text-[#7d8590]">
            <Loader size={12} className="animate-spin" />
            <span>{progress.phase}…</span>
          </div>
          {progress.total > 0 && (
            <>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-[#21262d]">
                <div
                  className="h-full bg-brand-500 transition-all"
                  style={{
                    width: `${(progress.done / progress.total) * 100}%`,
                  }}
                />
              </div>
              {progress.currentPath && (
                <div className="mt-1 truncate text-[10px] text-[#6e7681]">
                  {progress.currentPath}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-[#f85149]/30 bg-[#f85149]/10 p-2 text-xs text-[#f85149]">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {lastResult && !error && (
        <div className="flex items-start gap-2 rounded-md border border-[#3fb950]/30 bg-[#3fb950]/10 p-2 text-xs text-[#3fb950]">
          <Check size={14} className="mt-0.5 flex-shrink-0" />
          <span>
            Generated <strong>{lastResult.filename}</strong> ({(lastResult.blob.size / 1024).toFixed(1)} KB) in {Math.round(lastResult.elapsedMs)}ms.
          </span>
        </div>
      )}
    </div>
  );
}
