/**
 * Project upload panel.
 *
 * Provides three ways to add a project folder:
 *   1. Drag-and-drop area (uses FileSystemEntry API for folder support)
 *   2. "Pick folder" button (uses File System Access API when available,
 *      falls back to webkitdirectory input)
 *   3. (Optional) load a single .zip archive as a project
 *
 * All uploads are processed locally — no network requests are made.
 */

import { useCallback, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { discoverFromFiles, discoverFromDirectoryHandle } from '@/lib/fileDiscovery';
import { FolderPlus, Upload, Loader, AlertTriangle } from '@/components/common/Icons';

interface Props {
  onProjectAdded?: (projectId: string) => void;
}

export function ProjectUpload({ onProjectAdded }: Props) {
  const { state, dispatch } = useAppState();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const filter = state.filter;

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      setIsProcessing(true);
      setError(null);
      setProgress(`Scanning ${arr.length} files…`);
      try {
        const project = await discoverFromFiles(arr, filter);
        dispatch({ type: 'ADD_PROJECT', project });
        onProjectAdded?.(project.id);
        setProgress(`Added project "${project.label}" with ${project.files.length} files`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to read folder');
      } finally {
        setIsProcessing(false);
      }
    },
    [filter, dispatch, onProjectAdded],
  );

  const handleDirPicker = useCallback(async () => {
    // Try File System Access API first.
    const w = window as any;
    if (w.showDirectoryPicker) {
      try {
        const handle = await w.showDirectoryPicker();
        setIsProcessing(true);
        setError(null);
        setProgress('Scanning directory…');
        const project = await discoverFromDirectoryHandle(handle, filter, (count) => {
          setProgress(`Scanned ${count} files…`);
        });
        dispatch({ type: 'ADD_PROJECT', project });
        onProjectAdded?.(project.id);
        setProgress(`Added project "${project.label}" with ${project.files.length} files`);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setError(err.message ?? 'Failed to open directory');
        }
      } finally {
        setIsProcessing(false);
      }
      return;
    }
    // Fallback: webkitdirectory input.
    inputRef.current?.click();
  }, [filter, dispatch, onProjectAdded]);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const items = e.dataTransfer.items;
      if (!items || items.length === 0) {
        await handleFiles(e.dataTransfer.files);
        return;
      }
      // Use webkitGetAsEntry to support folder drop.
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      if (entries.length === 0) {
        await handleFiles(e.dataTransfer.files);
        return;
      }
      setIsProcessing(true);
      setError(null);
      setProgress('Reading dropped folder…');
      try {
        for (const entry of entries) {
          const files = await collectFilesFromEntry(entry);
          if (files.length > 0) {
            // Synthesize webkitRelativePath on each File by patching it into
            // a synthetic object that discoverFromFiles expects.
            const synth = files.map((f) => {
              const path = (f as any)._relativePath ?? f.name;
              const fakeFile = new File([f], f.name, { type: f.type, lastModified: f.lastModified });
              Object.defineProperty(fakeFile, 'webkitRelativePath', {
                value: `${entry.name}/${path}`,
                configurable: true,
              });
              return fakeFile;
            });
            const project = await discoverFromFiles(synth, filter);
            dispatch({ type: 'ADD_PROJECT', project });
            onProjectAdded?.(project.id);
          }
        }
        setProgress('Done');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to read dropped folder');
      } finally {
        setIsProcessing(false);
      }
    },
    [filter, dispatch, onProjectAdded, handleFiles],
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
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
          isDragging
            ? 'border-brand-500 bg-brand-500/5'
            : 'border-[#30363d] hover:border-[#484f58]'
        }`}
        onClick={handleDirPicker}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleDirPicker();
          }
        }}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="text-[#7d8590]">
            {isProcessing ? <Loader className="animate-spin" size={28} /> : <FolderPlus size={28} />}
          </div>
          <div className="text-sm font-medium text-[#e6edf3]">
            {isProcessing
              ? progress ?? 'Processing…'
              : 'Drop a project folder here'}
          </div>
          <div className="text-xs text-[#6e7681]">
            or click to browse — your files stay in your browser
          </div>
        </div>
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

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-[#f85149]/30 bg-[#f85149]/10 p-2 text-xs text-[#f85149]">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!error && progress && !isProcessing && (
        <div className="text-xs text-[#7d8590]">{progress}</div>
      )}
    </div>
  );
}

/** Recursively collect files from a FileSystemEntry (drop API). */
function collectFilesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file(
        (file) => {
          // Patch the relative path onto the file.
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
