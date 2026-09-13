'use client';

/**
 * Codice — main application component (Next.js client entry).
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

import { useEffect, useRef, useState } from 'react';
import { AppStateProvider, useAppState } from '@/hooks/useAppState';
import { ToastProvider, useToast } from '@/components/common/Toast';
import { MetadataDialog } from '@/components/common/MetadataDialog';
import { HelpDialog } from '@/components/common/HelpDialog';
import { OnboardingTour } from '@/components/common/OnboardingTour';
import { isTourDone, markTourDone, resetTourDone } from '@/lib/onboardingTour';
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
  FileText,
  Keyboard,
  Printer,
  Compass,
} from '@/components/common/Icons';
import type { UIThemeMode } from '@/lib/themes/uiTheme';
import { ensureSyntaxThemeCatalog } from '@/lib/themes/syntaxThemeRegistry';

/** True when the keyboard event originates from a text-entry control. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

/** Fire a window-level command event consumed by the export panel. */
function requestExport() {
  window.dispatchEvent(new CustomEvent('codice:export'));
}

/** Fire a window-level command event consumed by the document outline. */
function requestToggleOutline() {
  window.dispatchEvent(new CustomEvent('codice:toggle-outline'));
}

function AppInner() {
  const { state, dispatch, getSelectedFiles } = useAppState();
  const toast = useToast();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  // Bumped on every (re)start so the tour remounts at step 1.
  const [tourKey, setTourKey] = useState(0);

  // Auto-start the guided tour on the very first visit only.
  useEffect(() => {
    if (!isTourDone()) {
      const t = window.setTimeout(() => {
        setTourKey((k) => k + 1);
        setTourOpen(true);
      }, 700);
      return () => window.clearTimeout(t);
    }
  }, []);

  // The welcome card can request the tour explicitly.
  useEffect(() => {
    const onStart = () => {
      resetTourDone();
      setTourKey((k) => k + 1);
      setTourOpen(true);
    };
    window.addEventListener('codice:start-tour', onStart);
    return () => window.removeEventListener('codice:start-tour', onStart);
  }, []);

  // Sync the syntax theme catalog with the installed Shiki package.
  const [, setCatalogVersion] = useState(0);
  useEffect(() => {
    ensureSyntaxThemeCatalog().then(() => setCatalogVersion((v) => v + 1));
  }, []);

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

  const startTour = () => {
    resetTourDone();
    setTourKey((k) => k + 1);
    setTourOpen(true);
  };

  const finishTour = () => {
    markTourDone();
    setTourOpen(false);
    toast.push({
      kind: 'info',
      title: 'Tour finished',
      message: 'Press ? any time to see all keyboard shortcuts.',
    });
  };

  // Keep the latest handler reachable from the mount-only key listener
  // (avoids a stale closure on state.uiTheme).
  const toggleThemeRef = useRef(toggleTheme);
  useEffect(() => {
    toggleThemeRef.current = toggleTheme;
  });

  // Global keyboard shortcuts (ignored while typing in inputs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        requestExport();
      } else if (mod && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setCustomizerOpen((v) => !v);
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        toggleThemeRef.current();
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.getElementById('codice-file-search')?.focus();
      } else if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        requestToggleOutline();
      } else if (e.key === '?' && !mod) {
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
              Source code → Documented code
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
            onClick={startTour}
            className="btn-ghost"
            title="Replay the guided tour"
            aria-label="Replay the guided tour"
          >
            <Compass size={14} />
          </button>
          <button
            onClick={toggleTheme}
            className="btn-ghost"
            title="Toggle theme (Ctrl+D)"
            aria-label="Toggle theme"
          >
            {state.uiTheme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button
            onClick={() => setHelpOpen(true)}
            className="btn-ghost"
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
          >
            <Keyboard size={14} />
          </button>
          <button
            onClick={() => setMetadataOpen(true)}
            className="btn-ghost"
            title="Edit document info (title page metadata)"
            aria-label="Edit document info"
          >
            <FileText size={14} />
          </button>
          <button
            onClick={() => window.print()}
            className="btn-ghost codice-print-button"
            title="Print the document preview"
            aria-label="Print preview"
          >
            <Printer size={14} />
          </button>
          <button
            onClick={() => setCustomizerOpen((v) => !v)}
            className="btn-secondary"
            title="Template editor (Ctrl+T)"
            data-tour="template"
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
      <div className="border-b border-app bg-app px-4 py-1 text-[11px] text-muted flex justify-center items-center">
        All processing happens in your browser — nothing is uploaded.
        <span
          title="Okay... SOME data gets uploaded 😚👉👈. Maybe your dog's birth certificate? Maybe?"
          aria-label="Privacy information and a joke."
        >
          <Sparkles className="cursor-pointer" size={14} style={{ color: 'var(--color-accent)' }} />
        </span>
      </div>


      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <aside
          className="flex w-80 flex-shrink-0 flex-col overflow-hidden border-r border-app bg-app"
          data-tour="files"
        >
          <ProjectsSidebar
            selectedProjectId={effectiveProjectId}
            onSelectProject={setSelectedProjectId}
          />
        </aside>

        <main
          className="flex flex-1 flex-col overflow-hidden"
          data-tour="preview"
        >
          <DocumentPreview />
        </main>
      </div>

      {/* Bottom bar — export panel */}
      <footer
        className="border-t border-app bg-surface px-4 py-3"
        data-tour="export"
      >
        <div className="mx-auto max-w-4xl">
          <ExportPanel />
        </div>
      </footer>

      <TemplateCustomizer
        open={customizerOpen}
        onClose={() => setCustomizerOpen(false)}
      />

      <MetadataDialog
        open={metadataOpen}
        onClose={() => setMetadataOpen(false)}
      />

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />

      <OnboardingTour key={tourKey} open={tourOpen} onFinish={finishTour} />
    </div>
  );
}

export default function CodiceApp() {
  return (
    <ToastProvider>
      <AppStateProvider>
        <AppInner />
      </AppStateProvider>
    </ToastProvider>
  );
}
