/**
 * File discovery — recursive scan of uploaded project folders.
 *
 * Supports four input modes:
 *  1. webkitdirectory upload (FileList with webkitRelativePath)
 *  2. File System Access API (FileSystemDirectoryHandle)
 *  3. Drag-and-drop of folders (DataTransferItem with webkitGetAsEntry)
 *  4. ZIP archives (picked or dropped — unpacked in-memory via JSZip)
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
import JSZip from 'jszip';
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

/** Wraps a lazily-read ZIP entry as a FileHandle (text is cached). */
class ZipEntryHandleImpl implements FileHandle {
  private _cached?: string;
  constructor(
    private readonly entry: JSZip.JSZipObject,
    private readonly _name: string,
  ) {}
  async getText(): Promise<string> {
    if (this._cached === undefined) {
      this._cached = await this.entry.async('string');
    }
    return this._cached;
  }
  get file(): File {
    // Synthesize a File on demand (content is already decoded text).
    return new File([this._cached ?? ''], this._name, { type: 'text/plain' });
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
export function makeFile(
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
 *
 * Files WITHOUT a `webkitRelativePath` (loose files, e.g. dragged from the
 * desktop) are accepted as a synthetic "Loose files" project instead of
 * being silently dropped — the folder structure is simply their file name.
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

  // Derive folder name from the first file that carries a relative path
  // (loose files don't have one, but may share the input with folder files).
  const firstRelFile = files.find((f) => Boolean((f as any).webkitRelativePath));
  const firstPath = firstRelFile
    ? ((firstRelFile as any).webkitRelativePath as string)
    : undefined;
  const hasRelativePaths = Boolean(firstRelFile);
  const folderName = firstPath
    ? firstPath.split('/')[0]
    : hasRelativePaths
      ? 'Project'
      : 'Loose files';
  const projectId = genId('p');
  const warnings: ScanWarning[] = [];
  if (!hasRelativePaths && files.length > 0) {
    warnings.push({
      severity: 'info',
      message: `Loose files were added without folder structure (${files.length} file${files.length === 1 ? '' : 's'})`,
    });
  }

  // Filter out excluded directories early.
  const excludedDirSet = new Set(filter.excludedDirs);
  const filtered: File[] = [];
  let skippedBinary = 0;
  let skippedLarge = 0;

  for (const file of files) {
    const rel = (file as any).webkitRelativePath as string | undefined;
    // Loose files (no relative path) use their bare name as the path.
    const stripped = rel ? stripFirstSegment(rel) : file.name;
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
    const rel = (file as any).webkitRelativePath as string | undefined;
    const stripped = rel ? stripFirstSegment(rel) : file.name;
    const handle = new FileHandleImpl(file);
    return makeFile(projectId, stripped, file.size, handle, filter);
  });

  if (discovered.length === 0) {
    throw new Error(
      'No readable files were found in the provided selection — everything was skipped as binary or too large.',
    );
  }

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

/**
 * Discover files from a ZIP archive uploaded by the user.
 *
 * The archive is unpacked in-memory (nothing is uploaded to a server).
 * Directories and binary entries are skipped; the same exclusion rules that
 * apply to folder uploads are enforced. If every entry shares a common
 * top-level folder (typical for GitHub tarball/zip downloads), that segment
 * becomes the project label and is stripped from relative paths.
 */
export async function discoverFromZipArchive(
  file: File,
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
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error(`Could not read "${file.name}" as a ZIP archive.`);
  }

  const entries = Object.values(zip.files).filter((e) => !e.dir);
  if (entries.length === 0) {
    throw new Error('The ZIP archive contains no files.');
  }

  // Detect a common top-level folder shared by every entry.
  const firstSegments = new Set(
    entries.map((e) => normalizePath(e.name).split('/')[0]),
  );
  const hasCommonRoot = firstSegments.size === 1;
  const commonRoot = hasCommonRoot ? entries[0].name.split('/')[0] : '';
  const folderName = hasCommonRoot ? commonRoot : file.name.replace(/\.zip$/i, '');
  const projectId = genId('p');
  const warnings: ScanWarning[] = [];
  const excludedDirSet = new Set(filter.excludedDirs);

  const discovered: DiscoveredFile[] = [];
  let skippedBinary = 0;
  let skippedLarge = 0;

  for (const entry of entries) {
    const raw = normalizePath(entry.name);
    const stripped = hasCommonRoot ? stripFirstSegment(raw) : raw;
    if (!stripped) continue;

    // Ignore OS/IDE metadata that commonly hides inside archives.
    if (stripped === '.DS_Store' || stripped.startsWith('__MACOSX/')) continue;

    const segments = stripped.split('/');
    const inExcluded = segments.some((seg) => {
      const lower = seg.toLowerCase();
      return excludedDirSet.has(lower) || excludedDirSet.has(seg);
    });
    if (inExcluded) continue;

    const meta = await entry.async('uint8array');
    if (meta.byteLength > SKIP_FILE_THRESHOLD) {
      skippedLarge++;
      warnings.push({
        severity: 'warn',
        message: `Skipped very large file: ${stripped} (${formatBytes(meta.byteLength)})`,
        filePath: stripped,
      });
      continue;
    }
    if (looksBinary(entry.name)) {
      skippedBinary++;
      continue;
    }

    const handle = new ZipEntryHandleImpl(entry, entry.name.split('/').pop() ?? entry.name);
    discovered.push(makeFile(projectId, stripped, meta.byteLength, handle, filter));
    onProgress?.(discovered.length);
  }

  if (discovered.length === 0) {
    throw new Error('No readable files were found in the ZIP archive.');
  }
  if (skippedBinary > 0) {
    warnings.push({
      severity: 'info',
      message: `${skippedBinary} binary file${skippedBinary === 1 ? '' : 's'} ignored`,
    });
  }

  // Surface large-but-not-skipped files.
  for (const f of discovered) {
    if (!f.excluded && f.size > LARGE_FILE_THRESHOLD) {
      warnings.push({
        severity: 'warn',
        message: `File exceeds recommended size: ${f.relativePath} (${formatBytes(f.size)})`,
        filePath: f.relativePath,
      });
    }
  }

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

/** True when the file looks like a ZIP archive the user wants unpacked. */
export function isZipFile(file: { name: string; type?: string }): boolean {
  return /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
}

/** Format bytes as a human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
