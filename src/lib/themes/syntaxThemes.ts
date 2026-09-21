/**
 * Legacy compatibility shim for the old `SYNTAX_THEMES` export.
 *
 * New code should use `syntaxThemeRegistry.ts` which derives the theme list
 * from Shiki's actual `bundledThemes` export. This shim keeps the old
 * `getTheme()` function working for any code that still references it.
 */

import { getSyntaxThemeCatalog, findSyntaxTheme, type SyntaxThemeOption } from './syntaxThemeRegistry';
import type { SyntaxTheme } from '@/types';

/** Convert a SyntaxThemeOption to the legacy SyntaxTheme shape. */
function toLegacyTheme(opt: SyntaxThemeOption): SyntaxTheme {
  return {
    id: opt.id,
    label: opt.name,
    dark: opt.dark,
    // These are filled with placeholder values — new code should call
    // getThemeColors() from the highlighter to get actual bg/fg.
    background: opt.dark ? '#0d1117' : '#ffffff',
    foreground: opt.dark ? '#e6edf3' : '#1f2328',
    shikiTheme: opt.id,
  };
}

/** All available syntax themes (derived from Shiki). */
export const SYNTAX_THEMES: SyntaxTheme[] =
  getSyntaxThemeCatalog().map(toLegacyTheme);

/** Look up a theme by id. */
export function getTheme(id: string): SyntaxTheme {
  const found = findSyntaxTheme(id);
  return found ? toLegacyTheme(found) : SYNTAX_THEMES[0];
}
