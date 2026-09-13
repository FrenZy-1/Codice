import { describe, it, expect } from 'vitest';
import {
  TOKEN_CATALOG,
  formatDateTimeValue,
  KNOWN_TOKENS,
  PAGE_DEPENDENT_TOKENS,
  expandTokens,
  tokenizeTemplate,
  buildStaticTokenContext,
} from '@/lib/tokens';

describe('expandTokens', () => {
  const ctx = {
    page: 3,
    pages: 12,
    title: 'Project Report',
    author: 'Ada Lovelace',
    date: '2/14/2026',
    time: '10:15 AM',
    files: 10,
    projectName: 'sample-app',
    fileName: 'App.java',
    lines: 42,
  };

  it('resolves every known token', () => {
    expect(expandTokens('{page}', ctx)).toBe('3');
    expect(expandTokens('{pages}', ctx)).toBe('12');
    expect(expandTokens('{title}', ctx)).toBe('Project Report');
    expect(expandTokens('{author}', ctx)).toBe('Ada Lovelace');
    expect(expandTokens('{date}', ctx)).toBe('2/14/2026');
    expect(expandTokens('{time}', ctx)).toBe('10:15 AM');
    expect(expandTokens('{files}', ctx)).toBe('10');
    expect(expandTokens('{projectName}', ctx)).toBe('sample-app');
    expect(expandTokens('{fileName}', ctx)).toBe('App.java');
    expect(expandTokens('{lines}', ctx)).toBe('42');
  });

  it('treats {project} as an alias of {projectName}', () => {
    expect(expandTokens('{project}', ctx)).toBe('sample-app');
  });

  it('mixes literals and tokens in a template', () => {
    expect(expandTokens('Page {page} of {pages} — {title}', ctx)).toBe(
      'Page 3 of 12 — Project Report',
    );
  });

  it('keeps unknown tokens literally so typos stay visible', () => {
    expect(expandTokens('{bogus} {page}', ctx)).toBe('{bogus} 3');
  });

  it('leaves templates without tokens untouched', () => {
    expect(expandTokens('Codice Report', ctx)).toBe('Codice Report');
    expect(expandTokens('', ctx)).toBe('');
  });

  it('keeps unknown tokens when context is empty', () => {
    expect(expandTokens('{mystery}', {})).toBe('{mystery}');
  });
});

describe('tokenizeTemplate', () => {
  it('splits text and token parts in order', () => {
    expect(tokenizeTemplate('Page {page} of {pages}')).toEqual([
      { kind: 'text', value: 'Page ' },
      { kind: 'token', value: '{page}' },
      { kind: 'text', value: ' of ' },
      { kind: 'token', value: '{pages}' },
    ]);
  });

  it('returns a single text part for token-free templates', () => {
    expect(tokenizeTemplate('plain')).toEqual([
      { kind: 'text', value: 'plain' },
    ]);
  });

  it('returns an empty list for an empty template', () => {
    expect(tokenizeTemplate('')).toEqual([]);
  });

  it('handles leading and trailing tokens', () => {
    expect(tokenizeTemplate('{title} —')).toEqual([
      { kind: 'token', value: '{title}' },
      { kind: 'text', value: ' —' },
    ]);
    expect(tokenizeTemplate('- {date}')).toEqual([
      { kind: 'text', value: '- ' },
      { kind: 'token', value: '{date}' },
    ]);
  });
});

describe('buildStaticTokenContext', () => {
  it('derives title/author/files/project from the document model', () => {
    const ctx = buildStaticTokenContext({
      metadata: { title: 'T', author: 'A' },
      firstProjectLabel: 'proj',
      fileCount: 7,
      now: new Date('2026-02-14T10:15:00'),
    });
    expect(ctx.title).toBe('T');
    expect(ctx.author).toBe('A');
    expect(ctx.files).toBe(7);
    expect(ctx.projectName).toBe('proj');
    expect(typeof ctx.date).toBe('string');
    expect(typeof ctx.time).toBe('string');
  });

  it('prefers explicit metadata date over the generation date', () => {
    const ctx = buildStaticTokenContext({
      metadata: { date: 'June 1, 2025' },
      fileCount: 0,
      now: new Date('2026-02-14T10:15:00'),
    });
    expect(ctx.date).toBe('June 1, 2025');
  });

  it('falls back to today when metadata date is empty', () => {
    const ctx = buildStaticTokenContext({
      metadata: {},
      fileCount: 0,
      now: new Date('2026-02-14T10:15:00'),
    });
    expect(ctx.date).toBe(new Date('2026-02-14T10:15:00').toLocaleDateString());
  });

  it('leaves page-dependent values blank (exporters inject them per page)', () => {
    const ctx = buildStaticTokenContext({
      metadata: {},
      fileCount: 2,
    });
    expect(ctx.page).toBe('');
    expect(ctx.pages).toBe('');
    expect(ctx.lines).toBe('');
    expect(ctx.fileName).toBe('');
  });
});

describe('catalog consistency', () => {
  it('documents every known token with label and example', () => {
    for (const info of TOKEN_CATALOG) {
      expect(info.token).toMatch(/^\{\w+\}$/);
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(0);
      expect(info.example.length).toBeGreaterThan(0);
    }
    // KNOWN_TOKENS mirrors the catalog.
    expect(KNOWN_TOKENS.size).toBe(TOKEN_CATALOG.length);
    // Page-dependent tokens are a subset of the catalog.
    for (const key of PAGE_DEPENDENT_TOKENS) {
      expect(KNOWN_TOKENS.has(`{${key}}`)).toBe(true);
    }
  });
});

describe('formatted date/time tokens', () => {
  const date = new Date('2026-02-14T09:07:05');
  const ctx = {
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    now: date,
  };

  it('formats {date:…} with the mini pattern', () => {
    expect(expandTokens('{date:yyyy-MM-dd}', ctx)).toBe('2026-02-14');
    expect(expandTokens('{date:dd/MM/yyyy}', ctx)).toBe('14/02/2026');
    expect(expandTokens('{date:yy.MM}', ctx)).toBe('26.02');
  });

  it('formats {time:…} with the mini pattern', () => {
    expect(expandTokens('{time:HH:mm}', ctx)).toBe('09:07');
    expect(expandTokens('{time:HH:mm:ss}', ctx)).toBe('09:07:05');
  });

  it('passes literal text through the pattern', () => {
    expect(expandTokens('{date:YYYY (week MM)}', ctx)).toBe('YYYY (week 02)');
  });

  it('keeps unformattable values as the raw token', () => {
    expect(expandTokens('{date:yyyy}', { date: 'not a date' })).toBe(
      '{date:yyyy}',
    );
  });

  it('ignores format suffixes on non-date tokens (value wins)', () => {
    expect(expandTokens('{page:yyyy}', { page: 3 })).toBe('3');
  });

  it('formatDateTimeValue pads numeric fields', () => {
    expect(formatDateTimeValue(date, 'yyyy-MM-dd HH:mm:ss', '')).toBe(
      '2026-02-14 09:07:05',
    );
  });
});
