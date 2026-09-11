/**
 * CodeDoc Generator — main application component.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ Top bar: title, settings, generate                       │
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
import { SettingsPanel } from '@/components/Settings/SettingsPanel';
import { Settings as SettingsIcon, Code, Sparkles, RefreshCw } from '@/components/common/Icons';

function AppInner() {
  const { state, dispatch, getSelectedFiles } = useAppState();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  // If no project is selected, pick the first one automatically.
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
      // Reset just the options/metadata by reloading.
      window.localStorage.removeItem('codedoc-generator-state-v1');
      window.location.reload();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-3 border-b border-[#30363d] bg-[#161b22] px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-brand-600 text-white">
            <Code size={16} />
          </div>
          <div>
            <div className="text-sm font-semibold text-[#e6edf3]">
              CodeDoc Generator
            </div>
            <div className="text-[10px] text-[#6e7681]">
              Source code → DOCX · PDF · ODT
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 text-xs text-[#7d8590]">
            <Sparkles size={12} />
            <span>{state.projects.length} project{state.projects.length === 1 ? '' : 's'}</span>
            <span className="text-[#30363d]">·</span>
            <span>{totalFiles} file{totalFiles === 1 ? '' : 's'} selected</span>
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            className="btn-secondary"
            title="Open settings"
          >
            <SettingsIcon size={14} />
            <span className="hidden sm:inline">Settings</span>
          </button>
          <button
            onClick={handleReset}
            className="btn-ghost"
            title="Reset to defaults"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      {/* Privacy banner */}
      <div className="border-b border-[#30363d] bg-[#0d1117] px-4 py-1 text-center text-[11px] text-[#6e7681]">
        Your source code stays on your machine. All processing happens in your browser — nothing is uploaded.
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-80 flex-col border-r border-[#30363d] bg-[#0d1117]">
          <ProjectsSidebar
            selectedProjectId={effectiveProjectId}
            onSelectProject={setSelectedProjectId}
          />
        </aside>

        {/* Preview */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <DocumentPreview />
        </main>
      </div>

      {/* Bottom bar — export panel */}
      <footer className="border-t border-[#30363d] bg-[#161b22] px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <ExportPanel />
        </div>
      </footer>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
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
