'use client';

/**
 * Layout Studio onboarding (§0).
 *
 * The custom layout system is powerful and non-obvious — the File →
 * Section → Block → Field hierarchy needs explaining ONCE, and must always
 * be reachable again via the studio's persistent "?" help button.
 *
 * Steps are DOM-anchored via `data-tour` attributes inside the studio
 * (same mechanism as the app-wide tour). A missing target (e.g. the field
 * editor only exists inside a section) is skipped automatically, so the
 * tour works on both empty and populated studios.
 */

import { useCallback, useEffect, useState } from 'react';
import { X, ChevronRight, ChevronLeft, Layers } from '@/components/common/Icons';

export interface LayoutTourStepDef {
  id: string;
  target: string | null;
  title: string;
  body: string;
}

const STEPS: LayoutTourStepDef[] = [
  {
    id: 'hierarchy',
    target: null,
    title: 'The layout hierarchy',
    body:
      'A layout is a three-level structure: FILE → SECTIONS → BLOCKS → FIELDS. ' +
      'The File layout is the document skeleton: an ordered list of sections. ' +
      'Each section holds standalone content plus blocks. A block is the repeated ' +
      'pattern for ONE file, and fields are the named content slots you fill in.',
  },
  {
    id: 'sections',
    target: 'layout-sections',
    title: '1 · File layout — sections',
    body:
      'Each card is a SECTION of your document (Task 01, Task 02, Answers…). ' +
      'A section type (Task, Code + Output, Description + Answer…) seeds a starting ' +
      'structure — you can then customize that individual section freely. ' +
      'Reorder sections to change the document flow.',
  },
  {
    id: 'block',
    target: 'layout-blocks',
    title: '2 · Blocks — the per-file pattern',
    body:
      'A BLOCK defines what happens for each file assigned to it: heading, ' +
      'description, code, note, images… Assign each file to exactly ONE block in ' +
      'one section — a file never repeats elsewhere in the document. Three files ' +
      'in one block = three instances of the same pattern.',
  },
  {
    id: 'fields',
    target: 'layout-fields',
    title: '3 · Fields — the content slots',
    body:
      'Fields are what you fill in: section fields (Task Title, Output, Answer) ' +
      'are shared by the section; block fields are filled PER FILE in File ' +
      'properties. The content-entry UI is generated from your fields — add or ' +
      'remove one and the forms follow automatically.',
  },
  {
    id: 'codevsfile',
    target: 'layout-palette',
    title: 'Which block is which?',
    body:
      'Common pitfall: the FILE node renders the full file presentation (header ' +
      '+ code). The CODE node renders ONLY the syntax-highlighted code — no header. ' +
      'If the preview looks "wrong", check which node you used. Hover any palette ' +
      'button for a plain-language explanation.',
  },
  {
    id: 'preview',
    target: 'layout-preview',
    title: 'Live preview',
    body:
      'This panel resolves your layout against your CURRENT files and field ' +
      'values — the same resolved stream the DOCX/PDF/ODT exporters receive. ' +
      'Export validation runs through this pipeline too: required fields must be ' +
      'filled before a document is generated.',
  },
];

const STORAGE_KEY = 'codice-layout-tour-done';

/** True when the layout tour has been completed (or skipped) before. */
export function isLayoutTourDone(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

export function markLayoutTourDone(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // ignore
  }
}

export function resetLayoutTourDone(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function LayoutOnboarding({
  open,
  onFinish,
}: {
  open: boolean;
  onFinish: () => void;
}) {
  const [index, setIndex] = useState(0);
  const step = STEPS[index];
  const total = STEPS.length;

  const next = useCallback(() => {
    if (index < total - 1) setIndex((i) => i + 1);
    else onFinish();
  }, [index, total, onFinish]);

  // Escape closes; arrow keys navigate (§41 — keyboard accessible).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onFinish();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        setIndex((i) => i - 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, index, next, onFinish]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onFinish} />
      <div
        className="panel relative w-full max-w-lg rounded-lg p-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Layout studio onboarding"
        data-layout-tour="true"
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded bg-[var(--color-accent)] text-white">
            <Layers size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-primary">{step.title}</h3>
            <p className="text-[10px] uppercase tracking-wide text-muted">
              Layout onboarding · step {index + 1} of {total}
            </p>
          </div>
          <button className="btn-ghost" onClick={onFinish} aria-label="Close onboarding">
            <X size={14} />
          </button>
        </div>
        <p className="text-xs leading-relaxed text-secondary">{step.body}</p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
          >
            <ChevronLeft size={13} /> Back
          </button>
          <div className="flex-1" />
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background:
                  i === index ? 'var(--color-accent)' : 'var(--color-border)',
              }}
            />
          ))}
          <div className="flex-1" />
          <button type="button" className="btn-primary" onClick={next}>
            {index === total - 1 ? 'Got it' : 'Next'}
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

export { STEPS as LAYOUT_TOUR_STEPS };
