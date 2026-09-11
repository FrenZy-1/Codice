/**
 * Codice — main application component.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ Top bar: title, theme toggle, customizer, generate       │
 *   ├───────────────┬─────────────────────────────────────────┤
 *   │ Projects      │  Document preview                       │
 *   │ sidebar       │                                         │
 *   │               │                                         │
 *   │ + upload      │                                         │
 *   │ + file tree   │                                         │
 *   │ + filters     │                                         │
 *   ├───────────────┴─────────────────────────────────────────┤
 *   │ Bottom bar: export panel                                 │
 *   └─────────────────────────────────────────────────────────┘
 */

import { useState } from 'react';
import { AppStateProvider, useAppState } from '@/hooks/useAppState';
import { ProjectsSidebar } from '@/components/ProjectsSidebar';
import { DocumentPreview } from '@/components/Preview/DocumentPreview';
import { ExportPanel } from '@/components/ExportPanel';
import { TemplateCustomizer } from '@/components/Settings/TemplateCustomizer';
import {
  Code,
  Sparkles,
  RefreshCw,
  Sun,
  Moon,
  Palette,
} from '@/components/common/Icons';
import type { UIThemeMode } from '@/lib/themes/uiTheme';

function AppInner() {
  const { state, dispatch, getSelectedFiles } = useAppState();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [customizerOpen, setCustomizerOpen] = useState(false);

  const effectiveProjectId =
    selectedProjectId && state.projects.some((p) => p.id === selectedProjectId)
      ? selectedProjectId
      : state.projects[0]?.id ?? null;

  const totalFiles = state.projects.reduce(
    (acc, p) => acc + getSelectedFiles(p.id).size,
    0,
  );

  const handleReset = () => {
    if (
      confirm(
        'Reset all settings to defaults? Uploaded projects will be kept.',
      )
    ) {
      window.localStorage.removeItem('codice-app-state-v2');
      window.localStorage.removeItem('codice-ui-theme');
      window.localStorage.removeItem('codice-custom-presets-v1');
      window.location.reload();
    }
  };

  const toggleTheme = () => {
    const next: UIThemeMode = state.uiTheme === 'dark' ? 'light' : 'dark';
    dispatch({ type: 'SET_UI_THEME', mode: next });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-3 border-b border-app bg-surface px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-brand-600 text-white">
            <Code size={16} />
          </div>
          <div>
            <div className="text-sm font-semibold text-primary">
              Codice
            </div>
            <div className="text-[10px] text-muted">
              Source code → DOCX · PDF · ODT
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 text-xs text-secondary">
            <Sparkles size={12} />
            <span>
              {state.projects.length} project
              {state.projects.length === 1 ? '' : 's'}
            </span>
            <span className="text-muted">·</span>
            <span>
              {totalFiles} file{totalFiles === 1 ? '' : 's'} selected
            </span>
          </div>
          <button
            onClick={toggleTheme}
            className="btn-ghost"
            title={state.uiTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label="Toggle theme"
          >
            {state.uiTheme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button
            onClick={() => setCustomizerOpen(true)}
            className="btn-secondary"
            title="Open template customizer"
          >
            <Palette size={14} />
            <span className="hidden sm:inline">Template</span>
          </button>
          <button
            onClick={handleReset}
            className="btn-ghost"
            title="Reset to defaults"
            aria-label="Reset to defaults"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      {/* Privacy banner */}
      <div className="border-b border-app bg-app px-4 py-1 text-center text-[11px] text-muted">
        Your source code stays on your machine. All processing happens in your browser — nothing is uploaded.
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="flex w-80 flex-col border-r border-app bg-app">
          <ProjectsSidebar
            selectedProjectId={effectiveProjectId}
            onSelectProject={setSelectedProjectId}
          />
        </aside>

        <main className="flex flex-1 flex-col overflow-hidden">
          <DocumentPreview />
        </main>
      </div>

      {/* Bottom bar — export panel */}
      <footer className="border-t border-app bg-surface px-4 py-3">
        <div className="mx-auto max-w-4xl">
          <ExportPanel />
        </div>
      </footer>

      <TemplateCustomizer
        open={customizerOpen}
        onClose={() => setCustomizerOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <AppInner />
    </AppStateProvider>
  );
}
