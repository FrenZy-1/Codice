/**
 * Minimal glob matcher.
 *
 * Supports:
 *   - `*` matches any sequence of characters except `/`
 *   - `**` matches any sequence including `/`
 *   - `?` matches a single character except `/`
 *   - literal characters match themselves
 *   - brace expansion: `{a,b,c}` -> `(a|b|c)`
 *
 * This is intentionally simple — it covers the patterns users typically
 * need for include/exclude rules without pulling in a heavy dependency.
 */

/** Convert a glob pattern into a RegExp. */
export function globToRegex(pattern: string): RegExp {
  let re = '';
  let i = 0;
  const n = pattern.length;

  while (i < n) {
    const c = pattern[i];

    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // ** — match across path separators
        re += '.*';
        i += 2;
        // Consume optional slash after **
        if (pattern[i] === '/') i += 1;
      } else {
        // * — match within a path segment
        re += '[^/]*';
        i += 1;
      }
      continue;
    }

    if (c === '?') {
      re += '[^/]?';
      i += 1;
      continue;
    }

    if (c === '{') {
      // Brace expansion
      const close = pattern.indexOf('}', i);
      if (close < 0) {
        re += '\\{';
        i += 1;
        continue;
      }
      const body = pattern.slice(i + 1, close);
      const parts = body.split(',').map(escapeRegex);
      re += `(?:${parts.join('|')})`;
      i = close + 1;
      continue;
    }

    if (c === '[') {
      // Character class — pass through up to ']'
      const close = pattern.indexOf(']', i);
      if (close < 0) {
        re += '\\[';
        i += 1;
        continue;
      }
      re += pattern.slice(i, close + 1);
      i = close + 1;
      continue;
    }

    re += escapeRegexChar(c);
    i += 1;
  }

  return new RegExp(`^${re}$`);
}

function escapeRegex(s: string): string {
  return s.split('').map(escapeRegexChar).join('');
}

function escapeRegexChar(c: string): string {
  if ('.+^$()|\\'.includes(c)) return `\\${c}`;
  return c;
}

/** Test whether a path matches a glob pattern. */
export function matchGlob(path: string, pattern: string): boolean {
  if (!pattern) return false;
  // Allow patterns that don't contain a slash to match the basename
  if (!pattern.includes('/') && !pattern.includes('**')) {
    const base = path.slice(path.lastIndexOf('/') + 1);
    return globToRegex(pattern).test(base);
  }
  return globToRegex(pattern).test(path);
}
