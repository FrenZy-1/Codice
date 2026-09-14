/**
 * Highlighter robustness (spec §8/§20):
 *   - language ids the installed Shiki does not ship fall back to plaintext
 *     (`.gitignore` → `ignore` produced "Language `ignore` not found");
 *   - plainHighlightedFile renders raw source so previews never get stuck
 *     on "Loading…" after a highlight failure (excluded → re-added files).
 */

import { describe, expect, it } from 'vitest';
import {
  resolveSupportedLanguage,
  plainHighlightedFile,
  highlightFile,
} from '../lib/highlight/highlighter';
import { detectLanguage, languageLabel } from '../lib/languageDetection';

describe('resolveSupportedLanguage (spec §20)', () => {
  it('falls back to plaintext for languages the installed Shiki does not bundle', async () => {
    // `ignore` is NOT a Shiki grammar — it used to throw at codeToTokens.
    expect(await resolveSupportedLanguage('ignore')).toBe('plaintext');
    expect(await resolveSupportedLanguage('not-a-language')).toBe('plaintext');
  });

  it('passes through real Shiki languages and null', async () => {
    expect(await resolveSupportedLanguage('javascript')).toBe('javascript');
    expect(await resolveSupportedLanguage('kotlin')).toBe('kotlin');
    expect(await resolveSupportedLanguage(null)).toBe('plaintext');
    expect(await resolveSupportedLanguage('plaintext')).toBe('plaintext');
  });

  it('special filenames map to displayable languages without invalid Shiki ids', () => {
    // The detected id for .gitignore remains a display concept — the
    // highlighter sanitizes it to plaintext before Shiki sees it.
    expect(detectLanguage('.gitignore')).not.toBeNull();
    expect(languageLabel(detectLanguage('.gitignore'))).toMatch(/Ignore/i);
    expect(detectLanguage('.dockerignore')).not.toBeNull();
    expect(detectLanguage('Dockerfile')).toBe('docker'); // valid Shiki id
    expect(detectLanguage('Makefile')).toBe('makefile'); // valid Shiki id
    expect(detectLanguage('CMakeLists.txt')).toBe('cmake'); // valid Shiki id
  });

  it('end-to-end: highlighting a `.gitignore` never throws and renders lines', async () => {
    const source = '# comment\nbuild/\n*.class';
    const result = await highlightFile('f1', '.gitignore', detectLanguage('.gitignore'), source, 'github-light');
    expect(result.lines.length).toBe(3);
    expect(result.lines.map((l) => l.text).join('\n')).toBe(source);
  });
});

describe('plainHighlightedFile (spec §8)', () => {
  it('produces one line per source line with plain tokens', () => {
    const hl = plainHighlightedFile('id1', 'src/Main.kt', 'fun a() {\n    return 1\n}');
    expect(hl.lines).toHaveLength(3);
    expect(hl.lines[1].text).toBe('    return 1');
    expect(hl.lines[1].tokens?.[0]?.start).toBe(0);
    expect(hl.lines[1].tokens?.[0]?.length).toBe(12);
    expect(hl.language).toBeNull();
  });

  it('handles empty sources and empty lines', () => {
    const empty = plainHighlightedFile('id2', 'x', '');
    expect(empty.lines).toHaveLength(1);
    expect(empty.lines[0].tokens).toHaveLength(0);

    const blanks = plainHighlightedFile('id3', 'x', 'a\n\nb');
    expect(blanks.lines[1].text).toBe('');
    expect(blanks.lines[1].tokens).toHaveLength(0);
  });

  it('keeps whitespace exactly (indentation preserved for re-added files)', () => {
    const hl = plainHighlightedFile('id4', 'x', '  indented\n\ttabbed');
    expect(hl.lines[0].text).toBe('  indented');
    expect(hl.lines[1].text).toBe('\ttabbed');
  });
});
