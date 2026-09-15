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
import { useToast } from '@/components/common/Toast';
import {
  discoverFromFiles,
  discoverFromDirectoryHandle,
  discoverFromZipArchive,
  discoverStandaloneFiles,
  isZipFile,
} from '@/lib/fileDiscovery';
import { normalizeImageFiles, isImageFile } from '@/lib/imageAssets';
import type { ProjectEntry } from '@/types';
import { FolderPlus, Loader, AlertTriangle, FileArchive, FilePlus, ImagePlus } from '@/components/common/Icons';

interface Props {
  onProjectAdded?: (projectId: string) => void;
}

export function ProjectUpload({ onProjectAdded }: Props) {
  const { state, dispatch } = useAppState();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  // §12 — import a folder's first-level subdirectories as SEPARATE
  // projects (one folder-picker operation → many projects).
  const [splitSubfolders, setSplitSubfolders] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('codice-split-subfolders') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('codice-split-subfolders', splitSubfolders ? '1' : '0');
    } catch {
      // ignore
    }
  }, [splitSubfolders]);

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

  /** §16 — route image files into the image library. Images dropped or
   * picked in the main upload area were previously rejected as "binary"
   * source files — now they import cleanly and appear in File properties
   * / layout image fields. */
  const handleImageFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return 0;
      const { assets, errors } = await normalizeImageFiles(files);
      if (assets.length > 0) {
        dispatch({ type: 'ADD_IMAGE_ASSETS', assets });
      }
      toast.push({
        kind: assets.length > 0 ? 'success' : 'error',
        title:
          assets.length > 0
            ? `Added ${assets.length} image${assets.length === 1 ? '' : 's'} to the library`
            : 'Image import failed',
        message:
          assets.length > 0
            ? 'Attach them in File properties or a layout image field.'
            : errors.join(' · ') || 'The files could not be decoded.',
      });
      for (const e of errors.slice(0, 2)) {
        toast.push({ kind: 'error', title: 'Image skipped', message: e });
      }
      return assets.length;
    },
    [dispatch, toast],
  );

  /** Add standalone files — merged into the persistent standalone project
   * (spec §4): first-class document inputs, never temporary uploads.
   * Image files are routed to the image library instead (§16). */
  const addStandaloneFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => isImageFile(f));
      const usable = files.filter((f) => !isZipFile(f) && !isImageFile(f));
      if (images.length > 0) await handleImageFiles(images);
      if (usable.length === 0) return images.length;
      setIsProcessing(true);
      setError(null);
      setProgress(`Adding ${usable.length} file${usable.length === 1 ? '' : 's'}…`);
      try {
        const { files: discovered, project } = await discoverStandaloneFiles(
          usable,
          filter,
        );
        dispatch({
          type: 'ADD_STANDALONE_FILES',
          project,
          files: discovered,
        });
        onProjectAdded?.(project.id);
        setProgress(`Added ${discovered.length} standalone file${discovered.length === 1 ? '' : 's'}`);
        return discovered.length;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add files');
        return images.length > 0 ? images.length : 0;
      } finally {
        setIsProcessing(false);
      }
    },
    [filter, dispatch, onProjectAdded, handleImageFiles],
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
      // §16 — loose image picks (no folder context) go to the library.
      const hasRelative = (f: File) => Boolean((f as any).webkitRelativePath);
      const looseImages = rest.filter((f) => isImageFile(f) && !hasRelative(f));
      const folderish = rest.filter((f) => !isImageFile(f) || hasRelative(f));
      if (looseImages.length > 0) await handleImageFiles(looseImages);
      if (folderish.length === 0) return;

      setIsProcessing(true);
      setError(null);
      // §12 — multi-folder in ONE operation: when enabled, a folder pick
      // whose files span multiple first-level subdirectories becomes one
      // project per subdirectory. The browser picker itself only allows a
      // single directory per pick (drag-drop of multiple folders always
      // worked); this makes one pick yield many projects.
      //
      // webkitRelativePath = "<pickedFolder>/<sub>/<path…>", so the
      // "first-level subdirectories of the picked folder" are segment 1.
      // Files at the picked folder's own root (no segment 2) stay together
      // under the picked folder's name.
      const relOf = (f: File) => (f as any).webkitRelativePath as string | undefined;
      const anyRelative = folderish.some((f) => Boolean(relOf(f)));
      const topLevel = new Set<string>();
      for (const f of folderish) {
        const rel = relOf(f);
        if (rel) {
          const seg = rel.split('/');
          topLevel.add(seg.length > 2 ? seg[1] : seg[0]);
        }
      }
      if (splitSubfolders && anyRelative && topLevel.size > 1) {
        // Regroup: rebase each file's relative path onto its subfolder so
        // discoverFromFiles derives the right project name + inner paths.
        const groups = new Map<string, File[]>();
        for (const f of folderish) {
          const rel = relOf(f);
          let key: string;
          let rebased: string;
          if (rel) {
            const seg = rel.split('/');
            if (seg.length > 2) {
              key = seg[1];
              rebased = rel.slice(seg[0].length + 1);
            } else {
              key = seg[0];
              rebased = rel;
            }
          } else {
            key = 'Loose files';
            rebased = f.name;
          }
          const copy = new File([f], f.name, { type: f.type, lastModified: f.lastModified });
          Object.defineProperty(copy, 'webkitRelativePath', {
            value: rebased,
            configurable: true,
          });
          const list = groups.get(key) ?? [];
          list.push(copy);
          groups.set(key, list);
        }
        let added = 0;
        for (const [, groupFiles] of groups) {
          try {
            const project = await discoverFromFiles(groupFiles, filter);
            addProject(project);
            added++;
          } catch {
            // per-group failure should not abort the others
          }
        }
        setProgress(`Added ${added} projects from ${groups.size} folders`);
        setIsProcessing(false);
        return;
      }

      setProgress(`Scanning ${folderish.length} files…`);
      try {
        const project = await discoverFromFiles(folderish, filter);
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
    [filter, addProject, handleZipFiles, handleImageFiles, splitSubfolders],
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
          // Loose (non-folder) dropped files: images go to the image
          // library (§16), everything else becomes standalone document
          // inputs (spec §4).
          const dropped = Array.from(e.dataTransfer.files).filter((f) => !isZipFile(f));
          const images = dropped.filter((f) => isImageFile(f));
          const others = dropped.filter((f) => !isImageFile(f));
          if (images.length > 0) await handleImageFiles(images);
          if (others.length > 0) await addStandaloneFiles(others);
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
    [filter, addProject, handleFiles, handleZipFiles, addStandaloneFiles, handleImageFiles],
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
        // spec §7 — the collapsed (compact) dropzone is itself a trigger for
        // the native folder picker; the Folder/ZIP chips remain separate
        // triggers (they stopPropagation, so no duplicate dialogs).
        onClick={handleDirPicker}
        role="button"
        tabIndex={0}
        aria-label={compact ? 'Add another project folder or ZIP archive — click to browse' : 'Drop a project folder or ZIP archive here, or click to browse'}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
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
                title="Add standalone files — merged into the Standalone files project"
                onClick={(e) => {
                  e.stopPropagation();
                  filesInputRef.current?.click();
                }}
              >
                <FilePlus size={10} /> Files
              </button>
              <button
                type="button"
                className="codice-input-chip cursor-pointer"
                title="Add images to the image library — attach them in File properties or layout image fields"
                onClick={(e) => {
                  e.stopPropagation();
                  imageInputRef.current?.click();
                }}
              >
                <ImagePlus size={10} /> Images
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
            <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
              <span className="codice-input-chip" title="Upload a folder">
                <FolderPlus size={10} /> Folder
              </span>
              <button
                type="button"
                className="codice-input-chip cursor-pointer"
                title="Add standalone files — merged into the Standalone files project"
                onClick={(e) => {
                  e.stopPropagation();
                  filesInputRef.current?.click();
                }}
              >
                <FilePlus size={10} /> Files
              </button>
              <button
                type="button"
                className="codice-input-chip cursor-pointer"
                title="Add images to the image library — attach them in File properties or layout image fields"
                onClick={(e) => {
                  e.stopPropagation();
                  imageInputRef.current?.click();
                }}
              >
                <ImagePlus size={10} /> Images
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
              <label
                className="flex cursor-pointer items-center gap-1 text-[10px] text-secondary"
                title="Import each first-level subdirectory as a separate project — one folder pick becomes many projects (multi-folder upload, §12)"
              >
                <input
                  type="checkbox"
                  className="h-3 w-3"
                  checked={splitSubfolders}
                  onChange={(e) => {
                    e.stopPropagation();
                    setSplitSubfolders(e.target.checked);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                Split subfolders into projects
              </label>
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

      {/* §4 — standalone file picker: any number of individual files, added
          as first-class document inputs into the persistent standalone
          project. Images are routed to the image library (§16). */}
      <input
        ref={filesInputRef}
        type="file"
        multiple
        className="hidden"
        aria-label="Add standalone files"
        onChange={(e) => {
          if (e.target.files) void addStandaloneFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />

      {/* §16 — image picker for the main upload area: imports into the
          image library (never treated as source files). */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/bmp"
        multiple
        className="hidden"
        aria-label="Add images to the library"
        onChange={(e) => {
          if (e.target.files) void handleImageFiles(Array.from(e.target.files));
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
