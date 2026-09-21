/**
 * Language detection.
 *
 * Maps file extensions and special filenames to a language identifier that
 * Shiki understands. Falls back to null when no language is detected — in
 * that case the file is rendered as plain text.
 */

/** Map of extension (without dot, lowercase) -> Shiki language id. */
const EXTENSION_MAP: Record<string, string> = {
  // C / C++
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  inl: 'cpp',

  // Java / Kotlin
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',

  // JVM
  scala: 'scala',
  groovy: 'groovy',
  gradle: 'groovy',

  // .NET
  cs: 'csharp',
  fs: 'fsharp',
  vb: 'vb',

  // Scripting / dynamic
  py: 'python',
  pyw: 'python',
  rb: 'ruby',
  php: 'php',
  lua: 'lua',
  pl: 'perl',
  pm: 'perl',

  // JS family
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',

  // Modern systems
  rs: 'rust',
  go: 'go',
  swift: 'swift',
  dart: 'dart',
  zig: 'zig',

  // Shell
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  bat: 'bat',
  cmd: 'bat',
  ps1: 'powershell',

  // Web
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  vue: 'vue',
  svelte: 'svelte',

  // Data / config
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  properties: 'properties',
  env: 'bash',

  // DB
  sql: 'sql',
  psql: 'sql',
  mysql: 'sql',

  // Build / docs
  md: 'markdown',
  markdown: 'markdown',
  rst: 'rst',

  // Other
  qml: 'qml',
  proto: 'proto',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'docker',
  makefile: 'makefile',
  txt: 'plaintext',
};

/** Map of exact filename (lowercase) -> Shiki language id. */
const FILENAME_MAP: Record<string, string> = {
  buildfile: 'groovy',
  'cmakelists.txt': 'cmake',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  dockerfile: 'docker',
  podfile: 'ruby',
  rakefile: 'ruby',
  gemfile: 'ruby',
  vagrantfile: 'ruby',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  '.profile': 'bash',
  '.gitignore': 'ignore',
  '.gitattributes': 'ignore',
  '.dockerignore': 'ignore',
  '.npmignore': 'ignore',
  '.editorconfig': 'ini',
};

/** Files whose names look like Dockerfile (e.g. Dockerfile.dev). */
function isDockerfileVariant(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === 'dockerfile' || lower.startsWith('dockerfile.');
}

/** Files that look like Makefile variants. */
function isMakefileVariant(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === 'makefile') return true;
  if (lower.endsWith('.mak')) return true;
  if (lower.endsWith('.mk')) return true;
  return false;
}

/**
 * Detect the language for a file.
 * @param name file name (e.g. "Main.java")
 * @returns Shiki language id or null.
 */
export function detectLanguage(name: string): string | null {
  if (!name) return null;

  const lower = name.toLowerCase();

  // Special filename checks first
  if (isDockerfileVariant(lower)) return 'docker';
  if (isMakefileVariant(lower)) return 'makefile';
  if (FILENAME_MAP[lower]) return FILENAME_MAP[lower];

  // Then extension
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = lower.slice(dot + 1);
  return EXTENSION_MAP[ext] ?? null;
}

/** Returns true if the extension / filename typically denotes a config file. */
export function isConfigFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (CONFIG_FILENAMES.has(lower)) return true;
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = lower.slice(dot + 1);
  return CONFIG_EXTENSIONS.has(ext);
}

const CONFIG_FILENAMES = new Set([
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'gradle.properties',
  'cmakelists.txt',
  'makefile',
  'dockerfile',
  '.gitignore',
  '.dockerignore',
  '.npmignore',
  '.editorconfig',
  'package.json',
  'package-lock.json',
  'pom.xml',
  'cargo.toml',
  'requirements.txt',
  'readme.md',
  'license',
  'license.md',
  'license.txt',
  'tsconfig.json',
  'jest.config.js',
  'vite.config.ts',
  'webpack.config.js',
  'rollup.config.js',
  'babel.config.js',
  '.env',
  '.env.local',
  '.env.production',
  'docker-compose.yml',
  'docker-compose.yaml',
]);

const CONFIG_EXTENSIONS = new Set([
  'gradle',
  'kts',
  'xml',
  'json',
  'yaml',
  'yml',
  'toml',
  'ini',
  'properties',
  'conf',
  'config',
  'env',
]);

/** Human-readable label for a language id, for display in the UI. */
export function languageLabel(id: string | null): string {
  if (!id) return 'Plain text';
  const map: Record<string, string> = {
    c: 'C',
    cpp: 'C++',
    csharp: 'C#',
    fsharp: 'F#',
    java: 'Java',
    kotlin: 'Kotlin',
    scala: 'Scala',
    groovy: 'Groovy',
    python: 'Python',
    ruby: 'Ruby',
    php: 'PHP',
    lua: 'Lua',
    perl: 'Perl',
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    jsx: 'JSX',
    tsx: 'TSX',
    rust: 'Rust',
    go: 'Go',
    swift: 'Swift',
    dart: 'Dart',
    bash: 'Shell',
    powershell: 'PowerShell',
    bat: 'Batch',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    less: 'Less',
    vue: 'Vue',
    svelte: 'Svelte',
    json: 'JSON',
    yaml: 'YAML',
    toml: 'TOML',
    xml: 'XML',
    ini: 'INI',
    properties: 'Properties',
    sql: 'SQL',
    markdown: 'Markdown',
    rst: 'reStructuredText',
    cmake: 'CMake',
    makefile: 'Makefile',
    docker: 'Dockerfile',
    ignore: 'Ignore file',
    plaintext: 'Plain text',
    qml: 'QML',
    proto: 'Protocol Buffers',
    graphql: 'GraphQL',
    vb: 'Visual Basic',
    zig: 'Zig',
  };
  return map[id] ?? id;
}

/**
 * §44 — the COMPREHENSIVE file-type filter option list, derived from THIS
 * central mapping (not a hand-duplicated list): every language reachable
 * through EXTENSION_MAP or FILENAME_MAP becomes a filter option, so adding
 * a language here automatically adds it to the sidebar filter.
 */
export function languageFilterOptions(): Array<{ id: string; label: string }> {
  const seen = new Map<string, string>();
  for (const ext of Object.keys(EXTENSION_MAP)) {
    const id = detectLanguage(`file.${ext}`);
    if (id && !seen.has(id)) seen.set(id, languageLabel(id));
  }
  for (const name of Object.keys(FILENAME_MAP)) {
    const id = detectLanguage(name);
    if (id && !seen.has(id)) seen.set(id, languageLabel(id));
  }
  return Array.from(seen, ([id, label]) => ({ id, label })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}
