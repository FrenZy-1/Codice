/**
 * Default exclusion rules.
 *
 * These prevent generated documents from being polluted with build artifacts,
 * version-control internals, IDE files, and binary assets. Users can change
 * any of these in the Settings panel.
 */

/** Directories excluded by default. Matched against any path segment. */
export const DEFAULT_EXCLUDED_DIRS: readonly string[] = [
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  'build',
  'dist',
  'out',
  'target',
  '.gradle',
  '.idea',
  '.vscode',
  '.vs',
  'coverage',
  '.cache',
  '.parcel-cache',
  '.next',
  '.nuxt',
  '.turbo',
  '.angular',
  'DerivedData',
  '*.xcodeproj',
  '*.xcworkspace',
  '.DS_Store',
  'vendor',
  '.terraform',
  '.serverless',
  '.firebase',
  '.dart_tool',
  '.fvm',
  '.pub-cache',
  '.pub',
  'Pods',
];

/** Extensions excluded by default (binaries, media, archives). */
export const DEFAULT_EXCLUDED_EXTENSIONS: readonly string[] = [
  // Binaries / compiled
  'o',
  'obj',
  'a',
  'so',
  'dll',
  'dylib',
  'lib',
  'exe',
  'class',
  'jar',
  'war',
  'ear',
  'pyc',
  'pyo',
  'pyd',
  'wasm',
  'pdb',
  'pdb',
  'ilk',
  'idb',
  // Archives
  'zip',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'jar',
  // Media
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'ico',
  'icns',
  'tiff',
  'tif',
  'webp',
  'heic',
  'svg', // SVG is text but usually not source
  'mp3',
  'mp4',
  'mpg',
  'mpeg',
  'mov',
  'avi',
  'wav',
  'flac',
  'ogg',
  'webm',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  // Lock files (kept as opt-in)
  'lock',
  // Misc
  'log',
  'tmp',
  'temp',
  'swp',
  'swo',
  'bak',
  'orig',
  // Fonts
  'ttf',
  'otf',
  'woff',
  'woff2',
  'eot',
];

/** Exact filenames excluded by default. */
export const DEFAULT_EXCLUDED_FILENAMES: readonly string[] = [
  '.DS_Store',
  'Thumbs.db',
  'ehthumbs.db',
  'desktop.ini',
  '.gitkeep',
  '.keep',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'gradle-wrapper.properties',
];

/** Maximum size (in bytes) of a single file before a warning is shown. */
export const LARGE_FILE_THRESHOLD = 512 * 1024; // 512 KB

/** Maximum size (in bytes) of a single file before it is skipped entirely. */
export const SKIP_FILE_THRESHOLD = 5 * 1024 * 1024; // 5 MB

/** Configuration of which file categories are enabled by default. */
export interface FilterConfig {
  /** Whether source-code files are included by default. */
  includeSource: boolean;
  /** Whether config/project files are included by default. */
  includeConfig: boolean;
  /** Whether Markdown / README files are included by default. */
  includeMarkdown: boolean;
  /** Directories excluded (matched against any path segment). */
  excludedDirs: string[];
  /** Extensions excluded. */
  excludedExtensions: string[];
  /** Exact filenames excluded. */
  excludedFilenames: string[];
  /** Glob patterns to include (overrides exclusions). */
  includeGlobs: string[];
  /** Glob patterns to exclude (in addition to defaults). */
  excludeGlobs: string[];
  /** Custom extensions to include (added to source map). */
  customExtensions: string[];
}

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  includeSource: true,
  includeConfig: true,
  includeMarkdown: true,
  excludedDirs: [...DEFAULT_EXCLUDED_DIRS],
  excludedExtensions: [...DEFAULT_EXCLUDED_EXTENSIONS],
  excludedFilenames: [...DEFAULT_EXCLUDED_FILENAMES],
  includeGlobs: [],
  excludeGlobs: [],
  customExtensions: [],
};

/**
 * Default filter configuration as a fresh object so callers can mutate it
 * without affecting the shared constant.
 */
export function defaultFilterConfig(): FilterConfig {
  return JSON.parse(JSON.stringify(DEFAULT_FILTER_CONFIG));
}
