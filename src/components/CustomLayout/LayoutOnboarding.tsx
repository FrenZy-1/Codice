'use client';

/**
 * Layout Studio onboarding (§0/§55).
 *
 * The custom layout system is powerful and non-obvious — the File →
 * Section → Block → Node/Field hierarchy needs explaining ONCE, and must
 * always be reachable again via the studio's persistent "?" help button.
 *
 * §55 — the tour uses the SAME spotlight mechanism as the main application
 * onboarding: steps are DOM-anchored via `data-tour` attributes inside the
 * studio, the spotlight cut-out highlights the actual control, and a
 * missing target (e.g. the per-export tab row when only one export exists)
 * is skipped automatically.
 */

import { OnboardingTour } from '@/components/common/OnboardingTour';
import type { TourStepDef } from '@/lib/onboardingTour';

export const LAYOUT_TOUR_STORAGE_KEY = 'codice-layout-tour-done';

export function isLayoutTourDone(): boolean {
  try {
    return localStorage.getItem(LAYOUT_TOUR_STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

export function markLayoutTourDone(): void {
  try {
    localStorage.setItem(LAYOUT_TOUR_STORAGE_KEY, '1');
  } catch {
    // ignore
  }
}

/** Clear the seen flag (used by tests / "replay" affordances). */
export function resetLayoutTourDone(): void {
  try {
    localStorage.removeItem(LAYOUT_TOUR_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * The studio walk-through (§55): spotlight-first, concise, ordered so each
 * step's target exists in the default studio view. Step 6 (export tabs)
 * only exists when several exports are configured without a shared layout
 * — it is skipped automatically otherwise.
 */
export function getLayoutTourSteps(): TourStepDef[] {
  return [
    {
      target: 'layout-templates',
      title: 'Saved layouts',
      body:
        'Every layout you save lives here. Create a new one, load the working example, or import/export layouts as JSON to share between documents.',
      placement: 'right',
    },
    {
      target: 'layout-tabs',
      title: 'Three areas, one job each',
      body:
        'File Layout is the document structure. Page Settings holds page size, margins, headers and footers. Assignment connects your files and projects to the document.',
      placement: 'bottom',
    },
    {
      target: 'layout-sections',
      title: 'File → Section → Block',
      body:
        'The File layout is an ordered mix of standalone content and sections. Each section holds its own content plus BLOCKS — the pattern repeated once per assigned file.',
      placement: 'bottom',
    },
    {
      target: 'layout-file-content',
      title: 'Standalone content, anywhere',
      body:
        'Headings, text, images, panels, dividers, spacers — add them at the end or use the “Insert here” rows to place them before, between or after sections.',
      placement: 'top',
    },
    {
      target: 'layout-section-content',
      title: 'Content order = field order',
      body:
        'Inside a section, the content list IS the settings: every node you add contributes its field automatically, in the same order. Delete the node, its field goes too.',
      placement: 'top',
    },
    {
      target: 'layout-fields',
      title: 'Binding in one sentence',
      body:
        'Binding = “put a value from your data here”. Select a node, open its Content dropdown and bind {fileName}, {filePath} or a custom field — or keep text static.',
      placement: 'top',
    },
    {
      target: 'layout-export-tabs',
      title: 'One layout per export',
      body:
        'Turn “Same layout for all exports” off and each export document gets its own layout tab here. On = one shared layout everywhere.',
      placement: 'bottom',
    },
    {
      target: 'layout-preview',
      title: 'Live preview',
      body:
        'Resolved with your real data: assignments, fields, images and tokens included. What you see here is what the exporter renders.',
      placement: 'left',
    },
  ];
}

export function LayoutOnboarding({
  open,
  onFinish,
}: {
  open: boolean;
  onFinish: () => void;
}) {
  return (
    <OnboardingTour
      open={open}
      onFinish={onFinish}
      steps={getLayoutTourSteps()}
      storageKey={LAYOUT_TOUR_STORAGE_KEY}
      label="Layout studio tour"
    />
  );
}
