/**
 * Onboarding tour — pure step catalogue and geometry helpers.
 *
 * The tour walks a new user through Codice's five key regions. Each step
 * targets an element marked with `data-tour="<id>"`. Steps are declared as
 * data (not JSX) so they can be unit-tested without a DOM renderer, and the
 * tooltip placement math lives here too so both jsdom tests and the real
 * browser share one implementation.
 */

export interface TourStepDef {
  /** Element is found via `[data-tour="<target>"]`. */
  target: string;
  title: string;
  body: string;
  /** Short kbd-style hint rendered under the body (optional). */
  hint?: string;
  /**
   * Preferred tooltip placement. The renderer may flip this when there is
   * not enough room; this is only the intent.
   */
  placement: 'bottom' | 'top' | 'right' | 'left';
}

/** Storage flag so the tour auto-runs only on the very first visit. */
export const TOUR_DONE_STORAGE_KEY = 'codice-tour-done-v1';

/** True when the tour has been completed (or explicitly dismissed). */
export function isTourDone(key: string = TOUR_DONE_STORAGE_KEY): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return true; // storage unavailable → never auto-start
  }
}

/** Mark the tour as seen. */
export function markTourDone(key: string = TOUR_DONE_STORAGE_KEY): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // ignore
  }
}

/** Clear the seen flag (used by "replay tour" affordances in tests). */
export function resetTourDone(): void {
  try {
    localStorage.removeItem(TOUR_DONE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** The canonical tour walk-through. Order matters. */
export function getTourSteps(): TourStepDef[] {
  return [
    {
      target: 'upload',
      title: 'Add your project',
      body: 'Drop a project folder or a .zip archive here. Everything is parsed locally in your browser — nothing is uploaded anywhere.',
      hint: 'FOLDER or ZIP',
      placement: 'right',
    },
    {
      target: 'files',
      title: 'Pick the files',
      body: 'Check files in the tree, use All / None / Invert for bulk selection, search to narrow down, and add glob rules to automate the selection.',
      hint: 'Ctrl+K to search',
      placement: 'right',
    },
    {
      target: 'rules',
      title: 'Automate the selection',
      body: 'Include and exclude glob rules keep the selection in sync while you browse. Save rule sets as presets, then re-apply or share them as JSON any time.',
      hint: 'Rules follow the active project',
      placement: 'right',
    },
    {
      target: 'stats',
      title: 'Watch the numbers',
      body: 'Live document statistics for everything selected: files by kind, total size, duplicate-name warnings and a per-language breakdown you can copy as Markdown.',
      placement: 'right',
    },
    {
      target: 'layouts',
      title: 'Structure the document',
      body: 'The Layout editor composes WHAT the document contains: sections, per-file blocks, headings, images, code — in any order. It walks you through its own tour when you open it.',
      hint: 'Structure lives here',
      placement: 'bottom',
    },
    {
      target: 'template',
      title: 'Style the document',
      body: 'The Template editor controls everything VISUAL: fonts, colors, the syntax theme, Document Density, and the title page / TOC toggles. Page size, margins, headers and footers live in the Layout editor instead.',
      hint: 'Ctrl+T',
      placement: 'bottom',
    },
    {
      target: 'images',
      title: 'Keep images at hand',
      body: 'Uploaded screenshots and diagrams live in the Image library — attach them to files in File properties or pick them from any Image node. They stay in your browser across sessions.',
      placement: 'right',
    },
    {
      target: 'preview',
      title: 'Inspect the preview',
      body: 'A faithful, paginated preview of the real document — including the title page, table of contents, project structure tree and highlighted code.',
      hint: 'Ctrl+O for the outline',
      placement: 'left',
    },
    {
      target: 'export',
      title: 'Generate the document',
      body: 'Export a polished DOCX, PDF or ODT with one click — or switch to Export groups to generate several different documents, each with its own projects, layout and file name. Cancel mid-run and re-download recent exports.',
      hint: 'Ctrl+E',
      placement: 'top',
    },
  ];
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TooltipPosition {
  left: number;
  top: number;
  placement: 'bottom' | 'top' | 'right' | 'left';
}

export const TOOLTIP_WIDTH = 288;
export const TOOLTIP_GAP = 12;
/** Margin kept between the spotlight cut-out and the viewport edge. */
export const SPOTLIGHT_MARGIN = 6;

/**
 * Compute the tooltip's viewport position for a target rect.
 *
 * Falls back through the preferred placement to any side that fits, and
 * finally clamps inside the viewport. Pure so it can be tested in jsdom.
 */
export function positionTooltip(
  rect: Rect,
  preferred: TourStepDef['placement'],
  viewport: { width: number; height: number },
  tooltipHeight = 150,
): TooltipPosition {
  const vw = viewport.width;
  const vh = viewport.height;

  const fitsBelow = rect.top + rect.height + TOOLTIP_GAP + tooltipHeight <= vh;
  const fitsAbove = rect.top - TOOLTIP_GAP - tooltipHeight >= 0;
  const fitsRight =
    rect.left + rect.width + TOOLTIP_GAP + TOOLTIP_WIDTH <= vw;
  const fitsLeft = rect.left - TOOLTIP_GAP - TOOLTIP_WIDTH >= 0;

  let placement = preferred;
  if (placement === 'bottom' && !fitsBelow && fitsAbove) placement = 'top';
  else if (placement === 'top' && !fitsAbove && fitsBelow) placement = 'bottom';
  else if (placement === 'right' && !fitsRight && fitsLeft) placement = 'left';
  else if (placement === 'left' && !fitsLeft && fitsRight) placement = 'right';

  // Second-chance fallback for edge placements when the preferred side and
  // its mirror are both too tight (e.g. a full-height sidebar target).
  if (
    (placement === 'right' && !fitsRight && !fitsLeft) ||
    (placement === 'left' && !fitsLeft && !fitsRight)
  ) {
    placement = fitsBelow ? 'bottom' : 'top';
  }
  if (
    (placement === 'bottom' && !fitsBelow && !fitsAbove) ||
    (placement === 'top' && !fitsAbove && !fitsBelow)
  ) {
    placement = fitsRight ? 'right' : 'left';
  }

  let left: number;
  let top: number;

  switch (placement) {
    case 'bottom':
      left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
      top = rect.top + rect.height + TOOLTIP_GAP;
      break;
    case 'top':
      left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
      top = rect.top - TOOLTIP_GAP - tooltipHeight;
      break;
    case 'right':
      left = rect.left + rect.width + TOOLTIP_GAP;
      top = rect.top + rect.height / 2 - tooltipHeight / 2;
      break;
    case 'left':
      left = rect.left - TOOLTIP_GAP - TOOLTIP_WIDTH;
      top = rect.top + rect.height / 2 - tooltipHeight / 2;
      break;
  }

  // Clamp inside the viewport with a small breathing margin.
  left = Math.min(Math.max(SPOTLIGHT_MARGIN, left), Math.max(SPOTLIGHT_MARGIN, vw - TOOLTIP_WIDTH - SPOTLIGHT_MARGIN));
  top = Math.min(Math.max(SPOTLIGHT_MARGIN, top), Math.max(SPOTLIGHT_MARGIN, vh - tooltipHeight - SPOTLIGHT_MARGIN));

  return { left, top, placement };
}

/**
 * The visible spotlight rect for a target: the element rect inflated by the
 * margin, clamped to the viewport.
 */
export function spotlightRect(rect: Rect, viewport: { width: number; height: number }): Rect {
  const left = Math.max(SPOTLIGHT_MARGIN, rect.left - SPOTLIGHT_MARGIN);
  const top = Math.max(SPOTLIGHT_MARGIN, rect.top - SPOTLIGHT_MARGIN);
  const right = Math.min(viewport.width - SPOTLIGHT_MARGIN, rect.left + rect.width + SPOTLIGHT_MARGIN);
  const bottom = Math.min(viewport.height - SPOTLIGHT_MARGIN, rect.top + rect.height + SPOTLIGHT_MARGIN);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}
