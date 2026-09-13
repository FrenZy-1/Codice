/**
 * Project upload panel.
 *
 * Provides multiple ways to add a project folder:
 *   1. Drag-and-drop area (uses FileSystemEntry API for folder support)
 *   2. "Pick folder" button (uses File System Access API when available,
 *      falls back to webkitdirectory input)
 *
 * All uploads are processed locally — no network requests are made.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import {
  discoverFromFiles,
  discoverFromDirectoryHandle,
  discoverFromZipArchive,
  isZipFile,
} from '@/lib/fileDiscovery';
import type { ProjectEntry } from '@/types';
import { FolderPlus, Loader, AlertTriangle, FileArchive } from '@/components/common/Icons';

interface Props {
  onProjectAdded?: (projectId: string) => void;
}

export function ProjectUpload({ onProjectAdded }: Props) {
  const { state, dispatch } = useAppState();
  const inputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const filter = state.filter;
  /** When projects are already loaded the dropzone shrinks (spec §15) so
   * the file tree and project info get the vertical space. */
  const compact = state.projects.length > 0;
  const [pulse, setPulse] = useState(false);
  const pulseTimer = useRef<number | null>(null);

  // The preview welcome screen can ask the dropzone to draw attention to
  // itself ("Show the upload area" CTA).
  useEffect(() => {
    const onPulse = () => {
      setPulse(true);
      if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
      pulseTimer.current = window.setTimeout(() => setPulse(false), 1600);
    };
    window.addEventListener('codice:pulse-upload', onPulse);
    return () => {
      window.removeEventListener('codice:pulse-upload', onPulse);
      if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
    };
  }, []);

  const addProject = useCallback(
    (project: ProjectEntry) => {
      dispatch({ type: 'ADD_PROJECT', project });
      onProjectAdded?.(project.id);
    },
    [dispatch, onProjectAdded],
  );

  /** Unpack one or more ZIP archives into projects. */
  const handleZipFiles = useCallback(
    async (zips: File[]) => {
      setIsProcessing(true);
      setError(null);
      let added = 0;
      try {
        for (const zip of zips) {
          setProgress(`Unpacking ${zip.name}…`);
          const project = await discoverFromZipArchive(zip, filter, (count) =>
            setProgress(`Unpacking ${zip.name} — ${count} files…`),
          );
          addProject(project);
          added++;
          setProgress(`Added project "${project.label}" with ${project.files.length} files`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to unpack ZIP archive');
      } finally {
        setIsProcessing(false);
      }
      return added;
    },
    [filter, addProject],
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      const zips = arr.filter((f) => isZipFile(f));
      const rest = arr.filter((f) => !isZipFile(f));
      if (zips.length > 0) await handleZipFiles(zips);
      if (rest.length === 0) return;
      setIsProcessing(true);
      setError(null);
      setProgress(`Scanning ${rest.length} files…`);
      try {
        const project = await discoverFromFiles(rest, filter);
        addProject(project);
        setProgress(
          `Added project "${project.label}" with ${project.files.length} files`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to read folder');
      } finally {
        setIsProcessing(false);
      }
    },
    [filter, addProject, handleZipFiles],
  );

  const handleDirPicker = useCallback(async () => {
    const w = window as any;
    if (w.showDirectoryPicker) {
      try {
        const handle = await w.showDirectoryPicker();
        setIsProcessing(true);
        setError(null);
        setProgress('Scanning directory…');
        const project = await discoverFromDirectoryHandle(
          handle,
          filter,
          (count) => setProgress(`Scanned ${count} files…`),
        );
        addProject(project);
        setProgress(
          `Added project "${project.label}" with ${project.files.length} files`,
        );
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setError(err.message ?? 'Failed to open directory');
        }
      } finally {
        setIsProcessing(false);
      }
      return;
    }
    inputRef.current?.click();
  }, [filter, addProject]);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const items = e.dataTransfer.items;
      if (!items || items.length === 0) {
        await handleFiles(e.dataTransfer.files);
        return;
      }
      const entries: FileSystemEntry[] = [];
      const droppedZips: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        const file = items[i].getAsFile?.();
        // Dropped .zip archives are unpacked rather than walked as folders.
        if (file && isZipFile(file) && entry?.isFile) {
          droppedZips.push(file);
          continue;
        }
        if (entry) entries.push(entry);
      }
      if (droppedZips.length > 0) {
        await handleZipFiles(droppedZips);
      }
      if (entries.length === 0) {
        if (droppedZips.length === 0) {
          await handleFiles(e.dataTransfer.files);
        }
        return;
      }
      setIsProcessing(true);
      setError(null);
      setProgress('Reading dropped folder…');
      try {
        for (const entry of entries) {
          const files = await collectFilesFromEntry(entry);
          if (files.length > 0) {
            const synth = files.map((f) => {
              const path = (f as any)._relativePath ?? f.name;
              const fakeFile = new File([f], f.name, {
                type: f.type,
                lastModified: f.lastModified,
              });
              Object.defineProperty(fakeFile, 'webkitRelativePath', {
                value: `${entry.name}/${path}`,
                configurable: true,
              });
              return fakeFile;
            });
            const project = await discoverFromFiles(synth, filter);
            addProject(project);
          }
        }
        setProgress('Done');
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to read dropped folder',
        );
      } finally {
        setIsProcessing(false);
      }
    },
    [filter, addProject, handleFiles, handleZipFiles],
  );

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`codice-dropzone ${compact ? 'codice-dropzone-compact' : ''} ${isDragging ? 'codice-dropzone-active' : ''} ${pulse ? 'codice-dropzone-pulse' : ''}`}
        data-tour="upload"
        onClick={compact ? undefined : handleDirPicker}
        role="button"
        tabIndex={0}
        aria-label={compact ? 'Add another project folder or ZIP archive' : 'Drop a project folder or ZIP archive here, or click to browse'}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !compact) {
            e.preventDefault();
            handleDirPicker();
          }
        }}
      >
        {compact ? (
          // Compact single-row dropzone — still a full drop target.
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className={`flex-shrink-0 text-secondary transition-transform duration-200 ${isDragging ? 'scale-110' : ''}`}>
                {isProcessing ? (
                  <Loader className="animate-spin" size={16} />
                ) : (
                  <FolderPlus size={16} />
                )}
              </div>
              <div className="min-w-0 truncate text-xs font-medium text-secondary">
                {isProcessing ? progress ?? 'Processing…' : 'Add another project — drop a folder or ZIP'}
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-1.5">
              <button
                type="button"
                className="codice-input-chip"
                title="Upload a folder"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDirPicker();
                }}
              >
                <FolderPlus size={10} /> Folder
              </button>
              <button
                type="button"
                className="codice-input-chip cursor-pointer"
                title="Upload a .zip archive — unpacked in your browser"
                onClick={(e) => {
                  e.stopPropagation();
                  zipInputRef.current?.click();
                }}
              >
                <FileArchive size={10} /> ZIP
              </button>
            </div>
          </div>
        ) : (
        <div className="flex flex-col items-center gap-2">
          <div className={`text-secondary transition-transform duration-200 ${isDragging ? 'scale-110' : ''}`}>
            {isProcessing ? (
              <Loader className="animate-spin" size={28} />
            ) : (
              <FolderPlus size={28} />
            )}
          </div>
          <div className="text-sm font-medium text-primary">
            {isProcessing
              ? progress ?? 'Processing…'
              : 'Drop a project folder or ZIP here'}
          </div>
          <div className="text-xs text-muted">
            or click to browse — your files stay in your browser
          </div>
          {!isProcessing && (
            <div className="mt-1 flex items-center gap-1.5">
              <span className="codice-input-chip" title="Upload a folder">
                <FolderPlus size={10} /> Folder
              </span>
              <button
                type="button"
                className="codice-input-chip cursor-pointer"
                title="Upload a .zip archive — unpacked in your browser"
                onClick={(e) => {
                  e.stopPropagation();
                  zipInputRef.current?.click();
                }}
              >
                <FileArchive size={10} /> ZIP
              </button>
            </div>
          )}
        </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        // @ts-ignore — webkitdirectory is a non-standard attribute
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <input
        ref={zipInputRef}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        multiple
        className="hidden"
        aria-label="Upload ZIP archives"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {error && (
        <div
          className="flex items-start gap-2 rounded-md border p-2 text-xs text-error"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-error) 30%, transparent)',
            background: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
          }}
        >
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!error && progress && !isProcessing && (
        <div className="text-xs text-secondary">{progress}</div>
      )}
    </div>
  );
}

function collectFilesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file(
        (file) => {
          const fullPath = entry.fullPath.replace(/^\//, '');
          const path = fullPath.includes('/')
            ? fullPath.slice(fullPath.indexOf('/') + 1)
            : fullPath;
          try {
            Object.defineProperty(file, '_relativePath', {
              value: path,
              configurable: true,
            });
          } catch {
            // ignore
          }
          resolve([file]);
        },
        () => resolve([]),
      );
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const allFiles: File[] = [];
      const readBatch = () => {
        reader.readEntries(async (entries) => {
          if (entries.length === 0) {
            resolve(allFiles);
            return;
          }
          for (const e of entries) {
            const sub = await collectFilesFromEntry(e);
            allFiles.push(...sub);
          }
          readBatch();
        }, () => resolve(allFiles));
      };
      readBatch();
    } else {
      resolve([]);
    }
  });
}
