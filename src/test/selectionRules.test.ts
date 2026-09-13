import { describe, it, expect } from 'vitest';
import {
  fileMatchesRule,
  isRuleDeselected,
  isRuleSelected,
  countRuleMatches,
  countRuleDeselected,
  countRuleSelectedTotal,
  countRescuedByIncludes,
  parseRuleInput,
} from '@/lib/selectionRules';
import { makeFile } from '@/lib/fileDiscovery';
import type { DiscoveredFile } from '@/types';

function f(path: string, size = 100): DiscoveredFile {
  return makeFile(
    'p1',
    path,
    size,
    {
      async getText() {
        return '';
      },
      get file(): File {
        return new File([''], 'x');
      },
    },
    {
      excludedDirs: [],
      excludedExtensions: [],
      excludedFilenames: [],
      includeGlobs: [],
      excludeGlobs: [],
      includeSource: true,
      includeConfig: true,
      includeMarkdown: true,
      customExtensions: [],
    },
  );
}

describe('selectionRules — fileMatchesRule', () => {
  it('matches basename patterns without a slash against the file name', () => {
    const file = f('src/utils/helpers.test.js');
    expect(fileMatchesRule(file, '*.test.js')).toBe(true);
    expect(fileMatchesRule(file, '*.spec.js')).toBe(false);
  });

  it('matches full-path patterns containing a slash', () => {
    const file = f('docs/guide.md');
    expect(fileMatchesRule(file, 'docs/**')).toBe(true);
    expect(fileMatchesRule(file, 'src/**')).toBe(false);
  });

  it('supports ** across directories and brace expansion', () => {
    expect(fileMatchesRule(f('a/b/c/__tests__/x.ts'), '**/__tests__/**')).toBe(true);
    expect(fileMatchesRule(f('src/x.d.ts'), '**/*.d.ts')).toBe(true);
    expect(fileMatchesRule(f('src/x.gen.ts'), '**/*.{gen,bak}.ts')).toBe(true);
    expect(fileMatchesRule(f('src/x.bak.ts'), '**/*.{gen,bak}.ts')).toBe(true);
    expect(fileMatchesRule(f('src/x.other.ts'), '**/*.{gen,bak}.ts')).toBe(false);
  });

  it('ignores empty and whitespace-only patterns', () => {
    const file = f('src/a.ts');
    expect(fileMatchesRule(file, '')).toBe(false);
    expect(fileMatchesRule(file, '   ')).toBe(false);
  });
});

describe('selectionRules — isRuleDeselected / counts', () => {
  const files = [
    f('src/App.ts'),
    f('src/App.test.ts'),
    f('src/util.spec.ts'),
    f('docs/readme.md'),
  ];

  it('deselects files matching ANY rule', () => {
    const patterns = ['*.test.ts', '*.spec.ts'];
    expect(isRuleDeselected(files[1], patterns)).toBe(true);
    expect(isRuleDeselected(files[2], patterns)).toBe(true);
    expect(isRuleDeselected(files[0], patterns)).toBe(false);
  });

  it('empty rule list deselects nothing', () => {
    expect(isRuleDeselected(files[0], [])).toBe(false);
    expect(countRuleDeselected(files, [])).toBe(0);
  });

  it('countRuleMatches returns per-pattern counts in order', () => {
    const counts = countRuleMatches(files, ['*.test.ts', '*.spec.ts', 'docs/**']);
    expect(counts).toEqual([1, 1, 1]);
  });

  it('countRuleMatches skips discovery-excluded files', () => {
    const withExcluded = [...files, f('build/out.test.ts')];
    // Mark the artifact as discovery-excluded.
    withExcluded[4].excluded = true;
    withExcluded[4].exclusionReason = 'Excluded extension';
    const counts = countRuleMatches(withExcluded, ['*.test.ts']);
    // Only src/App.test.ts counts — build/out.test.ts is already excluded.
    expect(counts).toEqual([1]);
    expect(countRuleDeselected(withExcluded, ['*.test.ts'])).toBe(1);
  });

  it('countRuleDeselected counts each file once even with overlapping rules', () => {
    const patterns = ['**/*.test.ts', '**/App.*'];
    // App.test.ts matches both; App.ts matches the second.
    expect(countRuleDeselected(files, patterns)).toBe(2);
  });
});

describe('selectionRules — parseRuleInput', () => {
  it('splits on newlines and commas and trims', () => {
    expect(parseRuleInput(' *.test.js , docs/**\n*.spec.ts ')).toEqual([
      '*.test.js',
      'docs/**',
      '*.spec.ts',
    ]);
  });

  it('drops empty segments', () => {
    expect(parseRuleInput('a.ts,,  ,b.ts')).toEqual(['a.ts', 'b.ts']);
    expect(parseRuleInput('   ')).toEqual([]);
  });
});

describe('selectionRules — include rules', () => {
  it('isRuleSelected matches with the same glob semantics', () => {
    const readme = f('docs/README.md');
    expect(isRuleSelected(readme, ['docs/**'])).toBe(true);
    expect(isRuleSelected(readme, ['src/**'])).toBe(false);
    expect(isRuleSelected(f('README.md'), ['*.md'])).toBe(true);
    expect(isRuleSelected(readme, [])).toBe(false);
  });

  it('countRuleSelectedTotal counts non-excluded matches once per file', () => {
    const local = [f('src/App.ts'), f('README.md'), f('docs/README.md')];
    expect(countRuleSelectedTotal(local, ['**/*.md', 'docs/**'])).toBe(2);
    expect(countRuleSelectedTotal([], ['src/**'])).toBe(0);
  });

  it('countRescuedByIncludes counts files removed by excludes but saved by includes', () => {
    const local = [
      f('docs/README.md'),
      f('docs/guide.md'),
      f('src/App.ts'),
    ];
    // docs/** removes both docs files; docs/README.md rescues exactly one.
    expect(countRescuedByIncludes(local, ['docs/**'], ['docs/README.md'])).toBe(1);
    // Without excludes or without includes, nothing is "rescued".
    expect(countRescuedByIncludes(local, [], ['docs/README.md'])).toBe(0);
    expect(countRescuedByIncludes(local, ['docs/**'], [])).toBe(0);
    // Files that exclude rules never touch don't count as rescued even
    // when they match an include pattern (disjoint rule sets).
    expect(countRescuedByIncludes(local, ['docs/guide.md'], ['src/App.ts'])).toBe(0);
  });

  it('countRescuedByIncludes skips discovery-excluded files', () => {
    const all = [f('docs/README.md')];
    all[0].excluded = true;
    all[0].exclusionReason = 'Excluded extension';
    expect(countRescuedByIncludes(all, ['docs/**'], ['docs/README.md'])).toBe(0);
  });
});
