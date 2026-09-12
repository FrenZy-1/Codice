/**
 * Shiki-based syntax highlighting service.
 *
 * Shiki runs in the browser and produces TextMate tokens with associated
 * colors. We convert its output into our `HighlightedLine[]` representation
 * so exporters (DOCX, PDF, ODT) can render the same tokens independently.
 *
 * Shiki is loaded lazily — themes and languages are only fetched when first
 * needed, keeping the initial bundle small.
 *
 * The list of available themes is derived from Shiki's `bundledThemes`
 * export via `syntaxThemeRegistry.ts` — we do NOT maintain a separate
 * hardcoded list.
 */

import type { HighlightedFile, HighlightedLine, HighlightToken } from '@/types';
import { resolveSyntaxTheme } from '@/lib/themes/syntaxThemeRegistry';

/** Singleton Shiki highlighter promise. */
let highlighterPromise: Promise<any> | null = null;

/** Set of languages we have already loaded into the highlighter. */
const loadedLanguages = new Set<string>();

/** Set of themes we have already loaded. */
const loadedThemes = new Set<string>();

/**
 * Get (or create) a Shiki highlighter instance.
 * Languages and themes are added on demand.
 */
async function getHighlighter(): Promise<any> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const shiki = await import('shiki');
      const hl = await shiki.createHighlighter({
        themes: [resolveSyntaxTheme(null)],
        langs: ['plaintext'],
      });
      loadedThemes.add(resolveSyntaxTheme(null));
      loadedLanguages.add('plaintext');
      return hl;
    })();
  }
  return await highlighterPromise;
}

/** Ensure a theme is loaded. Silently falls back if Shiki can't load it. */
async function ensureTheme(theme: string): Promise<void> {
  const safeTheme = resolveSyntaxTheme(theme);
  if (loadedThemes.has(safeTheme)) return;
  const hl = await getHighlighter();
  try {
    await hl.loadTheme(safeTheme);
    loadedThemes.add(safeTheme);
  } catch {
    // Theme unavailable — fall back to default.
    loadedThemes.add(safeTheme);
  }
}

/** Ensure a language is loaded. Falls back to plaintext if unavailable. */
async function ensureLanguage(lang: string): Promise<void> {
  if (!lang || loadedLanguages.has(lang)) return;
  try {
    const hl = await getHighlighter();
    await hl.loadLanguage(lang as any);
    loadedLanguages.add(lang);
  } catch {
    // Language unavailable — fall back to plaintext.
    loadedLanguages.add(lang);
  }
}

/**
 * Highlight a source file.
 *
 * @param fileId Stable file id.
 * @param relativePath Display path.
 * @param language Shiki language id (or null for plaintext).
 * @param source Raw source text.
 * @param theme Shiki theme id.
 */
export async function highlightFile(
  fileId: string,
  relativePath: string,
  language: string | null,
  source: string,
  theme: string,
): Promise<HighlightedFile> {
  const safeTheme = resolveSyntaxTheme(theme);
  await ensureTheme(safeTheme);
  const lang = language ?? 'plaintext';
  await ensureLanguage(lang);

  const hl = await getHighlighter();

  // Use Shiki's tokens-to-hast output to get color/style info.
  const result = hl.codeToTokens(source, {
    lang,
    theme: safeTheme,
    includeExplanation: false,
  });

  // result.tokens is Token[][] (array of lines, each line an array of tokens).
  // Each Token has: content, color?, fontStyle? (bitmask: 1=bold,2=italic,4=underline)
  const lines: HighlightedLine[] = [];
  const shikiLines: any[] = result.tokens;

  for (let i = 0; i < shikiLines.length; i++) {
    const tokens: HighlightToken[] = [];
    let offset = 0;
    for (const tok of shikiLines[i]) {
      const content: string = tok.content ?? '';
      if (content.length === 0) continue;
      const bold = (tok.fontStyle & 1) === 1;
      const italic = (tok.fontStyle & 2) === 2;
      const underline = (tok.fontStyle & 4) === 4;
      tokens.push({
        start: offset,
        length: content.length,
        scopes: [],
        color: tok.color,
        bold,
        italic,
        underline,
      });
      offset += content.length;
    }
    // Reconstruct line text from tokens (Shiki already splits by line).
    const text = shikiLines[i].map((t: any) => t.content ?? '').join('');
    lines.push({
      lineNumber: i + 1,
      tokens,
      text,
    });
  }

  return {
    fileId,
    relativePath,
    language,
    lines,
  };
}

/** Background / foreground colors for a given Shiki theme. */
export async function getThemeColors(
  theme: string,
): Promise<{ background: string; foreground: string }> {
  const safeTheme = resolveSyntaxTheme(theme);
  await ensureTheme(safeTheme);
  const hl = await getHighlighter();
  const themeData = hl.getTheme(safeTheme);
  return {
    background: themeData.bg,
    foreground: themeData.fg,
  };
}

/** Preload common languages to make first highlight faster. */
export async function warmup(): Promise<void> {
  await ensureTheme(resolveSyntaxTheme(null));
  const common = ['javascript', 'typescript', 'python', 'java', 'go', 'rust'];
  await Promise.all(common.map((l) => ensureLanguage(l)));
}
