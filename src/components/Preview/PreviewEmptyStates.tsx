'use client';

/**
 * Preview empty states.
 *
 * Two variants:
 *  - Welcome (no projects yet): a compact onboarding panel that explains the
 *    3-step workflow and pulses the sidebar dropzone on CTA click.
 *  - No selection (projects exist but nothing selected): a quieter hint that
 *    points at the file tree.
 *
 * Both replace the otherwise-blank A4 page so first-run users always see
 * guidance instead of an empty sheet.
 */

import { useEffect, useState } from 'react';
import {
  FolderPlus,
  CheckSquare,
  Download,
  FileCode,
  MousePointerClick,
  Sparkles,
  Compass,
} from '@/components/common/Icons';

/** Fire the event that makes the sidebar dropzone pulse. */
function pulseDropzone() {
  window.dispatchEvent(new CustomEvent('codice:pulse-upload'));
}

/** Ask the app shell to start the guided tour. */
function startTour() {
  window.dispatchEvent(new CustomEvent('codice:start-tour'));
}

const STEPS = [
  {
    icon: FolderPlus,
    title: 'Add your project',
    body: 'Drop a folder, pick one, or upload a ZIP — everything stays on your machine.',
    kbd: null as string | null,
  },
  {
    icon: CheckSquare,
    title: 'Pick the files',
    body: 'Check files in the tree. Bulk-select with All / Invert, or search to narrow down.',
    kbd: 'Ctrl+K',
  },
  {
    icon: Download,
    title: 'Generate the document',
    body: 'Export a styled DOCX, PDF or ODT — title page, TOC, structure tree and all.',
    kbd: 'Ctrl+E',
  },
] as const;

export function PreviewWelcome() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 30);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      className={`codice-fade-in mx-auto max-w-lg py-10 transition-all duration-500 ${
        mounted ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      <div className="rounded-xl border border-app bg-surface p-6 shadow-lg">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-white shadow-md"
            style={{
              background:
                'linear-gradient(135deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 60%, #000))',
            }}
          >
            <FileCode size={20} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-primary">
              Turn source code into a polished document
            </h2>
            <p className="text-xs text-muted">
              DOCX · PDF · ODT — generated entirely in your browser
            </p>
          </div>
        </div>

        {/* Steps */}
        <ol className="mt-5 space-y-0" aria-label="Getting started steps">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            const isLast = i === STEPS.length - 1;
            return (
              <li key={step.title} className="relative flex gap-3 pb-4 last:pb-0">
                {/* Connector line */}
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className="absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px"
                    style={{
                      background:
                        'linear-gradient(to bottom, var(--color-border), transparent)',
                    }}
                  />
                )}
                <span
                  aria-hidden="true"
                  className="z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-app bg-surface-elevated text-secondary"
                  style={{ color: 'var(--color-accent)' }}
                >
                  <Icon size={15} />
                </span>
                <span className="min-w-0 flex-1 pt-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-primary">
                      {i + 1}. {step.title}
                    </span>
                    {step.kbd && <kbd className="kbd">{step.kbd}</kbd>}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-secondary">
                    {step.body}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

        {/* CTA */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={pulseDropzone}
            aria-label="Show the upload area in the sidebar"
          >
            <MousePointerClick size={14} />
            Show the upload area
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={startTour}
            aria-label="Take the guided tour"
            title="A five-step walk through every region of the app"
          >
            <Compass size={14} />
            Take the tour
          </button>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
            <Sparkles size={12} style={{ color: 'var(--color-accent)' }} />
            Press <kbd className="kbd">?</kbd> for all shortcuts
          </span>
        </div>
      </div>

      <p className="mt-3 text-center text-[11px] text-muted">
        Nothing leaves this tab — parsing, highlighting and export run locally.
      </p>
    </div>
  );
}

export function PreviewNoSelection({ projectCount }: { projectCount: number }) {
  return (
    <div className="codice-fade-in mx-auto max-w-md py-12 text-center">
      <div
        className="codice-empty mx-auto"
        role="status"
        aria-label="No files selected"
      >
        <CheckSquare size={26} className="mx-auto text-muted" />
        <div className="mt-3 text-sm font-medium text-secondary">
          {projectCount === 1
            ? 'Select files to preview your document'
            : `Select files from any of your ${projectCount} projects`}
        </div>
        <div className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">
          The preview mirrors the exported document — pick files in the sidebar
          tree and they appear here instantly. Use{' '}
          <kbd className="kbd">All</kbd> to select every file at once.
        </div>
      </div>
    </div>
  );
}
