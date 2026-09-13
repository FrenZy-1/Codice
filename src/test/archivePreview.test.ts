import { describe, it, expect } from 'vitest';
import {
  buildArchiveTree,
  archiveTreeStats,
  formatArchiveTree,
  formatArchiveSize,
  assignDocumentNames,
  type ArchivePreviewEntry,
} from '@/lib/archivePreview';

function file(path: string, size?: number, badge?: string): ArchivePreviewEntry {
  return { path, size, badge };
}

describe('buildArchiveTree', () => {
  it('nests flat archive paths into a tree', () => {
    const root = buildArchiveTree([
      file('src/lib/db.ts', 10),
      file('src/app/page.tsx', 20),
      file('README.md', 5),
    ]);
    expect(root.isFile).toBe(false);
    const src = root.children.find((c) => c.name === 'src');
    expect(src).toBeDefined();
    expect(src!.isFile).toBe(false);
    const lib = src!.children.find((c) => c.name === 'lib');
    expect(lib!.isFile).toBe(false);
    expect(lib!.children.map((c) => c.name)).toEqual(['db.ts']);
  });

  it('keeps a file and a directory with the same name as separate nodes', () => {
    const root = buildArchiveTree([
      file('api/api.ts', 3), // "api" directory
      file('api', 7), // "api" file at the same level
    ]);
    const names = root.children.map((c) => `${c.name}:${c.isFile}`);
    expect(names).toEqual(['api:false', 'api:true']);
  });

  it('trims whitespace around path segments and skips empty segments', () => {
    const root = buildArchiveTree([file('  src / lib / a.ts  ', 1)]);
    expect(root.children[0].name).toBe('src');
    expect(root.children[0].children[0].name).toBe('lib');
  });

  it('ignores blank paths entirely', () => {
    const root = buildArchiveTree([file('///'), file('a.ts', 1)]);
    expect(root.children.map((c) => c.name)).toEqual(['a.ts']);
  });

  it('marks nodes partial when a size is unknown and keeps badges', () => {
    const root = buildArchiveTree([
      file('doc.docx'), // unknown size
      file('doc2.pdf', 100),
      file('doc3.odt', undefined, '15 files'),
    ]);
    const docx = root.children[0];
    expect(docx.partial).toBe(true);
    expect(docx.size).toBe(0);
    expect(root.children[1].partial).toBe(false);
    expect(root.children[2].badge).toBe('15 files');
  });
});

describe('archiveTreeStats', () => {
  it('counts files, directories and total bytes (root not a dir)', () => {
    const root = buildArchiveTree([
      file('src/a.ts', 1),
      file('src/b.ts', 2),
      file('docs/readme.md', 4),
      file('top.txt', 8),
    ]);
    const stats = archiveTreeStats(root);
    expect(stats.files).toBe(4);
    expect(stats.dirs).toBe(2); // src + docs (root excluded)
    expect(stats.totalBytes).toBe(15);
    expect(stats.partial).toBe(false);
  });

  it('flags partial when any descendant size is unknown', () => {
    const root = buildArchiveTree([file('src/a.ts'), file('b.ts', 5)]);
    const stats = archiveTreeStats(root);
    expect(stats.partial).toBe(true);
    expect(stats.totalBytes).toBe(5);
  });
});

describe('formatArchiveTree', () => {
  it('renders exact Unicode box-drawing lines with dirs before files', () => {
    const root = buildArchiveTree([
      file('z.ts', 1),
      file('src/lib/a.ts', 2),
      file('src/b.ts', 3),
    ]);
    // Dirs first at each level: "src" before "z.ts"; inside src: "lib" before "b.ts".
    const lines = formatArchiveTree(root).split('\n');
    expect(lines).toEqual([
      '├── src/',
      '│   ├── lib/',
      '│   │   └── a.ts',
      '│   └── b.ts',
      '└── z.ts',
    ]);
  });

  it('uses └── for the last child at every level', () => {
    const root = buildArchiveTree([file('a.ts', 1), file('b.ts', 2)]);
    expect(formatArchiveTree(root).split('\n')).toEqual([
      '├── a.ts',
      '└── b.ts',
    ]);
  });

  it('appends size meta for known file sizes with meta enabled', () => {
    const root = buildArchiveTree([file('a.ts', 512), file('b.ts', 2048)]);
    const lines = formatArchiveTree(root, { meta: true }).split('\n');
    expect(lines).toEqual([
      '├── a.ts  —  512 B',
      '└── b.ts  —  2.0 KB',
    ]);
  });

  it('prefers the badge over the size in meta mode', () => {
    const root = buildArchiveTree([file('qa-project.docx', 1234, '15 files')]);
    expect(formatArchiveTree(root, { meta: true })).toBe(
      '└── qa-project.docx  —  15 files',
    );
  });

  it('omits meta entirely without meta enabled', () => {
    const root = buildArchiveTree([file('a.ts', 512, '15 files')]);
    expect(formatArchiveTree(root)).toBe('└── a.ts');
  });
});

describe('formatArchiveSize', () => {
  it('formats bytes, kilobytes and megabytes compactly', () => {
    expect(formatArchiveSize(0)).toBe('0 B');
    expect(formatArchiveSize(1023)).toBe('1023 B');
    expect(formatArchiveSize(1024)).toBe('1.0 KB');
    expect(formatArchiveSize(2560)).toBe('2.5 KB');
    expect(formatArchiveSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatArchiveSize(5 * 1024 * 1024 + 12)).toBe('5.0 MB');
  });
});

describe('assignDocumentNames', () => {
  it('sanitizes each label into the requested extension', () => {
    expect(assignDocumentNames(['My Project'], 'pdf')).toEqual(['My_Project.pdf']);
    expect(assignDocumentNames(['a/b\\c'], 'docx')).toEqual(['a_b_c.docx']);
    expect(assignDocumentNames(['??'], 'odt')).toEqual(['output.odt']);
  });

  it('collapses dot-runs and strips leading/trailing separators', () => {
    // Parity with ExportPanel.sanitizeFilename: "../etc/passwd" must not keep "..".
    expect(assignDocumentNames(['../etc/passwd'], 'pdf')).toEqual([
      'etc_passwd.pdf',
    ]);
    expect(assignDocumentNames(['.hidden-name-'], 'pdf')).toEqual([
      'hidden-name.pdf',
    ]);
    expect(assignDocumentNames(['a...b'], 'pdf')).toEqual(['a.b.pdf']);
  });

  it('suffixes duplicate labels with _2, _3, … before the extension', () => {
    expect(assignDocumentNames(['demo', 'demo', 'demo'], 'docx')).toEqual([
      'demo.docx',
      'demo_2.docx',
      'demo_3.docx',
    ]);
  });

  it('treats labels that sanitize to the same base as collisions', () => {
    expect(assignDocumentNames(['my app', 'my/app'], 'pdf')).toEqual([
      'my_app.pdf',
      'my_app_2.pdf',
    ]);
  });

  it('returns names positionally aligned with the input labels', () => {
    const names = assignDocumentNames(['x', 'y', 'z'], 'odt');
    expect(names).toHaveLength(3);
    expect(names[0]).toBe('x.odt');
    expect(names[1]).toBe('y.odt');
    expect(names[2]).toBe('z.odt');
  });
});
