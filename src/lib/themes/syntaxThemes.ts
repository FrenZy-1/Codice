import type { SyntaxTheme } from '@/types';

/** Built-in syntax themes. */
export const SYNTAX_THEMES: SyntaxTheme[] = [
  {
    id: 'github-dark',
    label: 'GitHub Dark',
    dark: true,
    background: '#24292e',
    foreground: '#e1e4e8',
    shikiTheme: 'github-dark',
  },
  {
    id: 'github-light',
    label: 'GitHub Light',
    dark: false,
    background: '#ffffff',
    foreground: '#24292e',
    shikiTheme: 'github-light',
  },
  {
    id: 'one-dark-pro',
    label: 'One Dark Pro',
    dark: true,
    background: '#282c34',
    foreground: '#abb2bf',
    shikiTheme: 'one-dark-pro',
  },
  {
    id: 'dracula',
    label: 'Dracula',
    dark: true,
    background: '#282a36',
    foreground: '#f8f8f2',
    shikiTheme: 'dracula',
  },
  {
    id: 'monokai',
    label: 'Monokai',
    dark: true,
    background: '#272822',
    foreground: '#f8f8f2',
    shikiTheme: 'monokai',
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    dark: false,
    background: '#fdf6e3',
    foreground: '#657b83',
    shikiTheme: 'solarized-light',
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    dark: true,
    background: '#002b36',
    foreground: '#93a1a1',
    shikiTheme: 'solarized-dark',
  },
  {
    id: 'nord',
    label: 'Nord',
    dark: true,
    background: '#2e3440',
    foreground: '#d8dee9',
    shikiTheme: 'nord',
  },
];

/** Look up a theme by id. */
export function getTheme(id: string): SyntaxTheme {
  return SYNTAX_THEMES.find((t) => t.id === id) ?? SYNTAX_THEMES[0];
}
