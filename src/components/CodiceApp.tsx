'use client';

/**
 * Codice — main application component (Next.js client entry).
 *
 * Layout (desktop):
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ Top bar: title, theme toggle, customizer, generate       │
 *   ├───────────┬──────────┬──────────────────────────────────┤
 *   │ Projects  │ Export   │  Document preview                │
 *   │ sidebar   │ rail     │                                  │
 *   │           │ (filename│                                  │
 *   │ + upload  │  format  │                                  │
 *   │ + tree    │  mode    │                                  │
 *   │ + filters │  generate│                                  │
 *   ├───────────┴──────────┴──────────────────────────────────┤
 *
 * On narrow screens the three columns stack (sidebar → preview → export).
 * (The former bottom export footer became the vertical export rail —
 * spec §13.)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppStateProvider, useAppState } from '@/hooks/useAppState';
import { ToastProvider, useToast } from '@/components/common/Toast';
import { MetadataDialog } from '@/components/common/MetadataDialog';
import { HelpDialog } from '@/components/common/HelpDialog';
import { OnboardingTour } from '@/components/common/OnboardingTour';
import { isTourDone, markTourDone, resetTourDone } from '@/lib/onboardingTour';
import { ProjectsSidebar } from '@/components/ProjectsSidebar';
import { DocumentPreview } from '@/components/Preview/DocumentPreview';
import { ExportPanel } from '@/components/ExportPanel';
import { SaveIndicator } from '@/components/common/SaveIndicator';
import { TemplateCustomizer } from '@/components/Settings/TemplateCustomizer';
import { CustomLayoutStudio } from '@/components/CustomLayout/CustomLayoutStudio';
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
  Layers,
  Github,
  ChevronLeft,
  ChevronRight,
} from '@/components/common/Icons';
import {
  layoutAttentionRequired,
} from '@/lib/customLayouts/validation';
import type { DocumentProject } from '@/types';
import type { UIThemeMode } from '@/lib/themes/uiTheme';
import { ensureSyntaxThemeCatalog } from '@/lib/themes/syntaxThemeRegistry';

/** localStorage key for the export-rail collapsed state (spec §5). */
const RAIL_COLLAPSED_KEY = 'codice-export-rail-collapsed';

function initialRailCollapsed(): boolean {
  try {
    return window.localStorage.getItem(RAIL_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

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
  const [studioOpen, setStudioOpen] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  // Bumped on every (re)start so the tour remounts at step 1.
  const [tourKey, setTourKey] = useState(0);
  // §5 — collapsible export rail. The preview automatically reclaims the
  // freed space (flex layout) — never an overlay.
  const [railCollapsed, setRailCollapsed] = useState<boolean>(initialRailCollapsed);
  useEffect(() => {
    try {
      window.localStorage.setItem(RAIL_COLLAPSED_KEY, railCollapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }, [railCollapsed]);

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

  // §21 — the Layout button's attention dot reflects REAL layout state:
  // unassigned selected files or missing required field values. It is not
  // a decorative "layout applied" badge — a fully wired layout shows no dot.
  const layoutNeedsAttention = useMemo(() => {
    const applied =
      state.customLayouts.find((t) => t.id === state.appliedLayoutId) ?? null;
    const docProjects: DocumentProject[] = state.projects.map((p) => ({
      id: p.id,
      label: p.label,
      folderName: p.folderName,
      structurePaths: [],
      files: p.files
        .filter((f) => !f.excluded && getSelectedFiles(p.id).has(f.id))
        .map((f) => ({
          projectId: p.id,
          projectLabel: p.label,
          relativePath: f.relativePath,
          language: f.language,
          highlighted: {
            fileId: f.id,
            relativePath: f.relativePath,
            language: f.language,
            lines: [],
          },
          sizeBytes: f.size,
        })),
    }));
    return layoutAttentionRequired(applied, {
      projects: docProjects,
      fileDetails: state.fileDetails,
      fileFieldValues: state.fileFieldValues,
      sectionFieldValues: state.sectionFieldValues,
      fileAssignments: state.layoutAssignments,
    });
  }, [
    state.customLayouts,
    state.appliedLayoutId,
    state.projects,
    state.fileDetails,
    state.fileFieldValues,
    state.sectionFieldValues,
    state.layoutAssignments,
    getSelectedFiles,
  ]);

  const handleReset = () => {
    if (
      confirm(
        'Reset all settings to defaults? Uploaded projects will be kept.',
      )
    ) {
      window.localStorage.removeItem('codice-app-state-v2');
      window.localStorage.removeItem('codice-ui-theme');
      window.localStorage.removeItem('codice-custom-presets-v1');
      window.localStorage.removeItem('codice-custom-layouts-v1');
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
      } else if (mod && e.key.toLowerCase() === 'l') {
        // §16 companion shortcut: Ctrl+L opens the Layout editor the same
        // way Ctrl+T opens the Template editor.
        e.preventDefault();
        setStudioOpen((v) => !v);
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
      <header className="codice-topbar flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-app px-3 py-2 sm:px-4">
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

        <div className="ml-auto flex flex-wrap items-center justify-end gap-1 sm:gap-2">
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
            <span className="text-muted">·</span>
            {/* R14 — quiet autosave affordance: pulses while the debounced
                write is pending, confirms "Saved", then fades to idle. */}
            <SaveIndicator />
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
          {/* §16 — Layouts BEFORE Template (intentional UX: you configure
              the layout — what the document contains — before styling it).
              Same buttons, same shortcuts (Ctrl+T = Template), swapped slots. */}
          <button
            onClick={() => setStudioOpen(true)}
            className="btn-secondary"
            title="Layout studio — compose what the document contains (Ctrl+L)"
            data-tour="layouts"
          >
            <Layers size={14} />
            <span className="hidden sm:inline">Layouts</span>
            {/* §21 — attention dot ONLY when the applied layout genuinely
                needs action (unassigned files / missing required values). */}
            {layoutNeedsAttention && (
              <span
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ background: 'var(--color-accent)' }}
                aria-hidden="true"
                title="This layout needs attention — files unassigned or required fields missing"
              />
            )}
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
          {/* §22/§40 — GitHub repository link. */}
          <a
            href="https://github.com/FrenZy-1/Codice"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost"
            title="GitHub — Codice repository (opens in a new tab)"
            aria-label="GitHub — Codice repository"
          >
            <Github size={14} />
          </a>
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

      {/* Main content — sidebar · export rail · preview (spec §13). On
          narrow screens the columns stack via order utilities. */}
      <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <aside
          className="order-1 flex max-h-[45vh] w-full flex-shrink-0 flex-col overflow-hidden border-b border-app bg-app lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r"
          data-tour="files"
        >
          <ProjectsSidebar
            selectedProjectId={effectiveProjectId}
            onSelectProject={setSelectedProjectId}
          />
        </aside>

        <aside
          className={`order-3 flex w-full flex-shrink-0 flex-col overflow-hidden border-t border-app bg-surface lg:order-2 lg:border-t-0 lg:border-r ${
            railCollapsed ? 'lg:w-11' : 'lg:w-60'
          }`}
          data-tour="export"
        >
          {/* §5 — collapse/expand toggle (desktop only; on narrow screens the
              rail is a stacked section and stays visible). Keyboard + screen
              reader accessible via aria-expanded/controls (§41). */}
          <button
            type="button"
            onClick={() => setRailCollapsed((v) => !v)}
            className="hidden h-7 w-full flex-shrink-0 items-center justify-center border-b border-app text-muted transition-colors hover:bg-app hover:text-primary lg:flex"
            title={railCollapsed ? 'Expand export rail' : 'Collapse export rail'}
            aria-label={railCollapsed ? 'Expand export rail' : 'Collapse export rail'}
            aria-expanded={!railCollapsed}
            aria-controls="codice-export-rail"
          >
            {railCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
          </button>
          {/* Collapsed rail: keep the panel for small screens (stacked), but
              replace it with a slim vertical label on desktop. */}
          {railCollapsed ? (
            <>
              <div
                className="hidden min-h-0 flex-1 items-start justify-center pt-3 lg:flex"
                aria-hidden="true"
              >
                <span
                  className="text-[10px] font-semibold uppercase tracking-widest text-muted"
                  style={{ writingMode: 'vertical-rl' }}
                >
                  Export
                </span>
              </div>
              <div id="codice-export-rail" className="min-h-0 flex-1 lg:hidden">
                <ExportPanel />
              </div>
            </>
          ) : (
            <div id="codice-export-rail" className="min-h-0 flex-1">
              <ExportPanel />
            </div>
          )}
        </aside>

        <main
          className="order-2 flex min-h-[320px] min-w-0 flex-1 flex-col overflow-hidden lg:order-3 lg:min-h-0"
          data-tour="preview"
        >
          <DocumentPreview />
        </main>
      </div>

      <TemplateCustomizer
        open={customizerOpen}
        onClose={() => setCustomizerOpen(false)}
      />

      <CustomLayoutStudio open={studioOpen} onClose={() => setStudioOpen(false)} />

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
