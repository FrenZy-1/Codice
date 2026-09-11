/**
 * File discovery — recursive scan of uploaded project folders.
 *
 * Supports three input modes:
 *  1. webkitdirectory upload (FileList with webkitRelativePath)
 *  2. File System Access API (FileSystemDirectoryHandle)
 *  3. Drag-and-drop of folders (DataTransferItem with webkitGetAsEntry)
 *
 * All modes are normalized into a `ProjectEntry` containing `DiscoveredFile`
 * records. Each `DiscoveredFile` carries a `FileHandle` that can later read
 * the file's text on demand (lazily).
 */

import type {
  DiscoveredFile,
  FileHandle,
  ProjectEntry,
  ScanWarning,
} from '@/types';
import { detectLanguage, isConfigFile } from './languageDetection';
import {
  DEFAULT_EXCLUDED_DIRS,
  DEFAULT_EXCLUDED_EXTENSIONS,
  DEFAULT_EXCLUDED_FILENAMES,
  LARGE_FILE_THRESHOLD,
  SKIP_FILE_THRESHOLD,
} from './defaultExclusions';
import { matchGlob } from './glob';

/** Wraps a File object (from webkitdirectory upload) as a FileHandle. */
class FileHandleImpl implements FileHandle {
  constructor(private readonly _file: File) {}
  async getText(): Promise<string> {
    return await this._file.text();
  }
  get file(): File {
    return this._file;
  }
}

/** Wraps a FileSystemFileHandle as a FileHandle. */
class FsHandleImpl implements FileHandle {
  private _cached?: File;
  constructor(private readonly handle: FileSystemFileHandle) {}
  async getText(): Promise<string> {
    const file = await this.handle.getFile();
    this._cached = file;
    return await file.text();
  }
  get file(): File | undefined {
    return this._cached;
  }
}

/** Generate a short id. */
function genId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Normalize a path: forward slashes, no leading slash, collapse `./`. */
function normalizePath(p: string): string {
  let s = p.replace(/\\/g, '/').replace(/^\.?\//, '');
  // Collapse `./` segments
  s = s.replace(/(^|\/)\.\//g, '$1');
  return s;
}

/** Returns true if the file is likely binary based on extension. */
function looksBinary(name: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = lower.slice(dot + 1);
  return DEFAULT_EXCLUDED_EXTENSIONS.includes(ext);
}

/** Strip a leading segment from a path. */
function stripFirstSegment(path: string): string {
  const slash = path.indexOf('/');
  if (slash < 0) return '';
  return path.slice(slash + 1);
}

/** Build a DiscoveredFile record. */
function makeFile(
  projectId: string,
  relativePath: string,
  size: number,
  handle: FileHandle,
  filter: {
    excludedDirs: string[];
    excludedExtensions: string[];
    excludedFilenames: string[];
    includeGlobs: string[];
    excludeGlobs: string[];
    includeSource: boolean;
    includeConfig: boolean;
    includeMarkdown: boolean;
    customExtensions: string[];
  },
): DiscoveredFile {
  const normalized = normalizePath(relativePath);
  const slash = normalized.lastIndexOf('/');
  const directory = slash >= 0 ? normalized.slice(0, slash) : '';
  const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot + 1) : '';
  const language = detectLanguage(name);
  const isConfig = isConfigFile(name);
  const isMd = ext === 'md' || ext === 'markdown';
  const binary = looksBinary(name);

  let excluded = false;
  let exclusionReason: string | undefined;

  // Forced includes override defaults
  const forced = filter.includeGlobs.some((g) => matchGlob(normalized, g));

  if (!forced) {
    if (binary) {
      excluded = true;
      exclusionReason = 'Binary file';
    } else if (filter.excludedFilenames.includes(lower)) {
      excluded = true;
      exclusionReason = 'Excluded filename';
    } else if (ext && filter.excludedExtensions.includes(ext)) {
      excluded = true;
      exclusionReason = 'Excluded extension';
    } else if (filter.excludeGlobs.some((g) => matchGlob(normalized, g))) {
      excluded = true;
      exclusionReason = 'Matches exclude glob';
    } else if (!filter.includeSource && language && !isConfig && !isMd) {
      excluded = true;
      exclusionReason = 'Source files disabled';
    } else if (!filter.includeConfig && isConfig) {
      excluded = true;
      exclusionReason = 'Config files disabled';
    } else if (!filter.includeMarkdown && isMd) {
      excluded = true;
      exclusionReason = 'Markdown files disabled';
    }
  }

  return {
    id: genId('f'),
    projectId,
    relativePath: normalized,
    name,
    directory,
    size,
    language,
    isConfig,
    binary,
    excluded,
    exclusionReason,
    fileHandle: handle,
  };
}

/**
 * Discover files from a FileList produced by `<input webkitdirectory>`.
 *
 * Each file's `webkitRelativePath` looks like `MyProject/src/main.ts`.
 * The first segment is the folder name; we strip it from the relative path
 * but keep it as the project's `folderName`.
 */
export async function discoverFromFiles(
  files: File[],
  filter: {
    excludedDirs: string[];
    excludedExtensions: string[];
    excludedFilenames: string[];
    includeGlobs: string[];
    excludeGlobs: string[];
    includeSource: boolean;
    includeConfig: boolean;
    includeMarkdown: boolean;
    customExtensions: string[];
  },
): Promise<ProjectEntry> {
  if (files.length === 0) {
    throw new Error('No files were provided.');
  }

  // Derive folder name from the first file's webkitRelativePath.
  const firstPath = (files[0] as any).webkitRelativePath as string | undefined;
  const folderName = firstPath ? firstPath.split('/')[0] : 'Project';
  const projectId = genId('p');
  const warnings: ScanWarning[] = [];

  // Filter out excluded directories early.
  const excludedDirSet = new Set(filter.excludedDirs);
  const filtered: File[] = [];
  let skippedBinary = 0;
  let skippedLarge = 0;

  for (const file of files) {
    const rel = (file as any).webkitRelativePath as string | undefined;
    if (!rel) continue;
    const stripped = stripFirstSegment(rel);
    if (!stripped) continue;

    // Check directory exclusions
    const segments = stripped.split('/');
    const inExcluded = segments.some((seg) => {
      const lower = seg.toLowerCase();
      // Match exact dir name or glob like "*.xcodeproj"
      return excludedDirSet.has(lower) || excludedDirSet.has(seg);
    });
    if (inExcluded) continue;

    if (file.size > SKIP_FILE_THRESHOLD) {
      skippedLarge++;
      warnings.push({
        severity: 'warn',
        message: `Skipped very large file: ${stripped} (${formatBytes(file.size)})`,
        filePath: stripped,
      });
      continue;
    }

    if (looksBinary(file.name)) {
      skippedBinary++;
      continue;
    }

    filtered.push(file);
  }

  if (skippedBinary > 0) {
    warnings.push({
      severity: 'info',
      message: `${skippedBinary} binary file${skippedBinary === 1 ? '' : 's'} ignored`,
    });
  }

  const discovered: DiscoveredFile[] = filtered.map((file) => {
    const rel = (file as any).webkitRelativePath as string;
    const stripped = stripFirstSegment(rel);
    const handle = new FileHandleImpl(file);
    return makeFile(projectId, stripped, file.size, handle, filter);
  });

  // Surface large-but-not-skipped files
  for (const f of discovered) {
    if (!f.excluded && f.size > LARGE_FILE_THRESHOLD) {
      warnings.push({
        severity: 'warn',
        message: `File exceeds recommended size: ${f.relativePath} (${formatBytes(f.size)})`,
        filePath: f.relativePath,
      });
    }
  }

  const selectedFiles = discovered.filter((f) => !f.excluded);
  const noLang = selectedFiles.filter((f) => !f.language).length;
  if (noLang > 0) {
    warnings.push({
      severity: 'info',
      message: `Language could not be detected for ${noLang} file${noLang === 1 ? '' : 's'}`,
    });
  }

  return {
    id: projectId,
    label: folderName,
    folderName,
    files: discovered,
    selectedCount: selectedFiles.length,
    selectedSize: selectedFiles.reduce((s, f) => s + f.size, 0),
    warnings,
    addedAt: Date.now(),
  };
}

/**
 * Discover files from a FileSystemDirectoryHandle (File System Access API).
 */
export async function discoverFromDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
  filter: {
    excludedDirs: string[];
    excludedExtensions: string[];
    excludedFilenames: string[];
    includeGlobs: string[];
    excludeGlobs: string[];
    includeSource: boolean;
    includeConfig: boolean;
    includeMarkdown: boolean;
    customExtensions: string[];
  },
  onProgress?: (count: number) => void,
): Promise<ProjectEntry> {
  const projectId = genId('p');
  const folderName = dirHandle.name;
  const discovered: DiscoveredFile[] = [];
  const warnings: ScanWarning[] = [];
  const excludedDirSet = new Set(filter.excludedDirs);

  async function walk(
    handle: FileSystemDirectoryHandle,
    prefix: string,
  ): Promise<void> {
    // @ts-ignore — iterables are supported in modern browsers
    for await (const entry of handle.values()) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.kind === 'directory') {
        const lower = entry.name.toLowerCase();
        if (excludedDirSet.has(lower) || excludedDirSet.has(entry.name)) {
          continue;
        }
        await walk(entry as FileSystemDirectoryHandle, path);
      } else if (entry.kind === 'file') {
        const fileHandle = entry as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        if (file.size > SKIP_FILE_THRESHOLD) {
          warnings.push({
            severity: 'warn',
            message: `Skipped very large file: ${path} (${formatBytes(file.size)})`,
            filePath: path,
          });
          continue;
        }
        if (looksBinary(file.name)) continue;
        const handle = new FsHandleImpl(fileHandle);
        const df = makeFile(projectId, path, file.size, handle, filter);
        discovered.push(df);
        onProgress?.(discovered.length);
      }
    }
  }

  await walk(dirHandle, '');

  const selected = discovered.filter((f) => !f.excluded);
  const noLang = selected.filter((f) => !f.language).length;
  if (noLang > 0) {
    warnings.push({
      severity: 'info',
      message: `Language could not be detected for ${noLang} file${noLang === 1 ? '' : 's'}`,
    });
  }

  return {
    id: projectId,
    label: folderName,
    folderName,
    files: discovered,
    selectedCount: selected.length,
    selectedSize: selected.reduce((s, f) => s + f.size, 0),
    warnings,
    addedAt: Date.now(),
  };
}

/** Format bytes as a human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
