/**
 * Pre-polish & consistency pass tests (Task 21 spec §20).
 *
 * Covers:
 *   - main-preview zoom ladder logic (§5)
 *   - DocumentPreview structure: relative pane root (§1 pills anchor),
 *     zoom toolbar (§5), page slots (§2 centering wrapper)
 *   - Page & Layout dependency gates in the Layout studio (§4 — the former
 *     TOC Advanced gate re-pointed to the current WS-2 structure: header/
 *     footer slot controls are hidden until their feature is enabled)
 *   - template preview zoom cannot resize the settings pane: min-w-0 on the
 *     preview pane + shared ToolbarButton language (§6/§12)
 *   - ODT exports: span colors via automatic styles, StructureLine without
 *     the code background, region tables for dual/triple headers (§7/§8/§9)
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent,
  act,
} from '@testing-library/react';
import JSZip from 'jszip';
import { AppStateProvider, useAppState } from '../hooks/useAppState';
import { ToastProvider } from '../components/common/Toast';
import { DocumentPreview } from '../components/Preview/DocumentPreview';
import { TemplateCustomizer } from '../components/Settings/TemplateCustomizer';
import { CustomLayoutStudio } from '../components/CustomLayout/CustomLayoutStudio';
import { markLayoutTourDone } from '../components/CustomLayout/LayoutOnboarding';
import { createEmptyTemplate } from '../lib/customLayouts/model';
import { stepZoomLadder, ZOOM_LADDER } from '../components/common/PreviewControls';
import {
  buildSpanAutoStyles,
  odtExporter,
  resetSpanStyles,
  spanStyleName,
} from '../lib/exporters/odtExporter';
import {
  buildProjectsModel,
  makeHighlightedFile,
} from './helpers/exportModels';

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  resetSpanStyles();
});

/* ------------------------------------------------------------------ */
/* Zoom ladder (§5)                                                    */
/* ------------------------------------------------------------------ */

describe('main preview zoom ladder (§5)', () => {
  it('steps through the documented levels in order', () => {
    expect(ZOOM_LADDER).toEqual([30, 40, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200]);
    expect(stepZoomLadder(100, 1)).toBe(125);
    expect(stepZoomLadder(100, -1)).toBe(90);
    expect(stepZoomLadder(90, 1)).toBe(100); // skips nothing
  });

  it('clamps at both ends of the ladder', () => {
    expect(stepZoomLadder(200, 1)).toBe(200);
    expect(stepZoomLadder(30, -1)).toBe(30);
  });

  it('snaps arbitrary (fit-derived) values to the next rung', () => {
    expect(stepZoomLadder(87, 1)).toBe(90);
    expect(stepZoomLadder(87, -1)).toBe(80);
    expect(stepZoomLadder(113, 1)).toBe(125);
  });
});

/* ------------------------------------------------------------------ */
/* DocumentPreview structure (§1/§2/§5)                                */
/* ------------------------------------------------------------------ */

function renderPreview() {
  function Probe() {
    const { state } = useAppState();
    return <DocumentPreview />;
  }
  return render(
    <ToastProvider>
      <AppStateProvider>
        <Probe />
      </AppStateProvider>
    </ToastProvider>,
  );
}

describe('document preview structure (§1/§2/§5)', () => {
  it('anchors the floating pills INSIDE a relative region below the toolbar (§1/§3)', () => {
    const { container } = renderPreview();
    // The §3 refinement: the pills anchor to a dedicated relative wrapper
    // that sits AFTER the tabs + toolbar rows — they can never overlap the
    // toolbar regardless of tabs/zoom (layout-system fix, not a magic top).
    const root = container.firstElementChild as HTMLElement;
    const anchor = root.querySelector('.codice-outline-toggle')
      ?.closest('div.relative');
    expect(anchor).toBeTruthy();
    expect(anchor!.className).toContain('relative');
    // The anchor region must contain the scroll container too — i.e. the
    // pills float over the preview surface, not over the toolbar.
    expect(anchor!.querySelector('.codice-print-area')).toBeTruthy();
  });

  it('renders a zoom toolbar with out / Fit / in controls (§5)', () => {
    renderPreview();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeTruthy();
    expect(screen.getByTitle('Fit to width')).toBeTruthy();
  });

  it('zoom in/out steps the label and Fit restores it (§5)', () => {
    // Deterministic fit base: pretend the scroll container is 1088px wide so
    // fit clamps to 100% before the first zoom step.
    const desc = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientWidth',
    );
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 1088,
    });
    try {
      renderPreview();
      const fit = screen.getByTitle('Fit to width');
      expect(fit.textContent).toBe('Fit');
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      expect(fit.textContent).toBe('125%');
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      expect(fit.textContent).toBe('150%');
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
      expect(fit.textContent).toBe('100%');
      fireEvent.click(fit);
      expect(fit.textContent).toBe('Fit');
    } finally {
      if (desc) Object.defineProperty(HTMLElement.prototype, 'clientWidth', desc);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Page & Layout dependency gates (§4 — Layout studio)                 */
/* ------------------------------------------------------------------ */

function renderEditor() {
  return render(
    <ToastProvider>
      <AppStateProvider>
        <TemplateCustomizer open onClose={() => {}} />
      </AppStateProvider>
    </ToastProvider>,
  );
}

/** Render the Layout studio with one saved template (page setup live). */
function renderStudio() {
  window.localStorage.setItem(
    'codice-custom-layouts-v1',
    JSON.stringify([createEmptyTemplate('Studio Fixture')]),
  );
  markLayoutTourDone();
  return render(
    <ToastProvider>
      <AppStateProvider>
        <CustomLayoutStudio open onClose={() => {}} />
      </AppStateProvider>
    </ToastProvider>,
  );
}

async function openPageLayout() {
  // §15 — page settings live behind the studio's top-level "Page Settings"
  // tab (real tabs, not the former "Page & Layout" accordion). act() flushes
  // the tab state update before the assertions run.
  await act(async () => {
    fireEvent.click(screen.getByRole('tab', { name: 'Page Settings' }));
  });
}

/** The footer group: the container holding the enable checkbox and every
 * dependent footer control (slot selects + custom text). */
function footerGroup(): HTMLElement {
  let el: HTMLElement | null = screen.getByLabelText(/Show page footer/);
  while (el && !el.querySelector('input[aria-label="Footer custom text"]')) {
    el = el.parentElement;
  }
  if (!el || !el.querySelector('input[aria-label="Footer custom text"]')) {
    throw new Error('footer group not found');
  }
  return el;
}

describe('Page & Layout dependency gates (§4)', () => {
  it('hides the header slot controls until the page header is enabled', async () => {
    renderStudio();
    await openPageLayout();
    // The University preset ships WITHOUT a page header → its dependent
    // controls are hidden (not merely disabled) until it is turned on.
    expect(screen.queryByLabelText('Header left text')).toBeNull();
    expect(screen.queryByLabelText('Header center text')).toBeNull();
    expect(screen.queryByLabelText('Header right text')).toBeNull();
    const advanced = screen.getByLabelText(/Show page header/);
    fireEvent.click(advanced);
    expect(screen.getByLabelText('Header left text')).toBeTruthy();
    expect(screen.getByLabelText('Header center text')).toBeTruthy();
    expect(screen.getByLabelText('Header right text')).toBeTruthy();
  });

  it('orders the footer slot selects before the footer custom text (spec tree)', async () => {
    renderStudio();
    await openPageLayout();
    // The University preset ships WITH a footer → its controls are visible.
    const group = footerGroup();
    const text = group.textContent ?? '';
    expect(text.indexOf('Left')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Left')).toBeLessThan(text.indexOf('Center'));
    expect(text.indexOf('Center')).toBeLessThan(text.indexOf('Right'));
    expect(text.indexOf('Right')).toBeLessThan(text.indexOf('Footer custom text'));
  });

  it('keeps the dependent controls inside the footer dependency gate', async () => {
    renderStudio();
    await openPageLayout();
    const cb = screen.getByLabelText(/Show page footer/) as HTMLInputElement;
    expect(cb.checked).toBe(true);
    fireEvent.click(cb); // disable the footer
    expect(screen.queryByLabelText('Footer left slot')).toBeNull();
    expect(screen.queryByLabelText('Footer center slot')).toBeNull();
    expect(screen.queryByLabelText('Footer right slot')).toBeNull();
    expect(screen.queryByLabelText('Footer custom text')).toBeNull();
    fireEvent.click(cb); // re-enable
    expect(screen.getByLabelText('Footer left slot')).toBeTruthy();
    expect(screen.getByLabelText('Footer custom text')).toBeTruthy();
  });

  it('hides the TOC alignment and numbering controls while the TOC is off', async () => {
    renderStudio();
    await openPageLayout();
    // Restored TOC gate (WS-6d): the alignment selects (a whole page of
    // their own, like the title page) and the numbering/metadata toggles
    // are dependents of "Table of contents" (§4) — hidden while it is off.
    fireEvent.click(screen.getByLabelText('Table of contents')); // off
    expect(screen.queryByLabelText('TOC horizontal alignment')).toBeNull();
    expect(screen.queryByLabelText('TOC vertical alignment')).toBeNull();
    expect(screen.queryByLabelText('Number headings')).toBeNull();
    expect(screen.queryByLabelText('Show file metadata')).toBeNull();
    fireEvent.click(screen.getByLabelText('Table of contents')); // on
    expect(screen.getByLabelText('TOC horizontal alignment')).toBeTruthy();
    expect(screen.getByLabelText('TOC vertical alignment')).toBeTruthy();
    expect(screen.getByLabelText('Number headings')).toBeTruthy();
  });

  it('TOC group collapses — chip tracks alignment, gate works while collapsed (WS-7b)', async () => {
    renderStudio();
    await openPageLayout();
    // Table of Contents is expanded by default; its chip summarizes the
    // TOC alignment pair ("left · top" for the University preset).
    const toc = screen.getByRole('button', { name: 'Table of Contents' });
    expect(toc.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('left · top')).toBeTruthy();
    // Collapse: aria-expanded flips, the chip still shows the summary.
    fireEvent.click(toc);
    expect(toc.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('left · top')).toBeTruthy();
    // The master gate keeps working while collapsed: dependents unmount
    // (§4) and the chip flips to "off"; re-enabling restores it.
    fireEvent.click(screen.getByLabelText('Table of contents'));
    expect(screen.getByText('off')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Table of contents'));
    expect(screen.getByText('left · top')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* Template preview pane cannot be resized by zoom (§6)                */
/* ------------------------------------------------------------------ */

describe('template preview pane sizing (§6)', () => {
  it('the customizer preview pane carries min-w-0 (no flex min-content growth)', () => {
    const { container } = renderEditor();
    const panes = Array.from(container.querySelectorAll('.flex-1'));
    const previewPane = panes.find((p) => p.className.includes('min-w-0'));
    expect(previewPane).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* ODT span styles + structure + region tables (§7/§8/§9)              */
/* ------------------------------------------------------------------ */

describe('ODT automatic span styles (§7)', () => {
  it('interns equivalent formats to one style and distinct formats apart', () => {
    resetSpanStyles();
    const a = spanStyleName({ color: '#ff0000' });
    const b = spanStyleName({ color: '#ff0000' });
    const c = spanStyleName({ color: '#00ff00', bold: true });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    const defs = buildSpanAutoStyles();
    expect(defs).toContain(`style:name="${a}"`);
    expect(defs).toContain('fo:color="#ff0000"');
    expect(defs).toContain('fo:font-weight="bold"');
    resetSpanStyles();
  });

  it('emits CS character styles into content.xml automatic-styles', async () => {
    const model = buildProjectsModel([
      {
        label: 'proj',
        files: [
          {
            path: 'src/Main.kt',
            language: 'kotlin',
            highlighted: makeHighlightedFile('src/Main.kt', 'val x = 1\n', '#ff0000'),
          },
        ],
      },
    ]);
    const result = await odtExporter.export(model, { format: 'odt', filename: 'odt-cs' });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const content = await zip.file('content.xml')!.async('string');
    expect(content).toContain('<text:span text:style-name="CS1">');
    expect(content).toContain('<office:automatic-styles>');
    expect(content).toMatch(/<style:style style:name="CS1" style:family="text">/);
  });

  it('structure lines use StructureLine (no code background) — §7', async () => {
    const model = buildProjectsModel([
      {
        label: 'proj',
        files: [
          {
            path: 'src/Main.kt',
            language: 'kotlin',
            highlighted: makeHighlightedFile('src/Main.kt', 'fun main() {}\n', '#000000'),
          },
        ],
        structurePaths: ['src/', 'src/Main.kt'],
      },
    ]);
    const result = await odtExporter.export(model, { format: 'odt', filename: 'odt-struct' });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const styles = await zip.file('styles.xml')!.async('string');
    expect(styles).toContain('style:name="StructureLine"');
    const structureStyle = styles.slice(
      styles.indexOf('style:name="StructureLine"') - 60,
      styles.indexOf('style:name="StructureLine"') + 500,
    );
    expect(structureStyle).not.toContain('background-color');
    // The tree paragraphs reference StructureLine, not CodeLine:
    const content = await zip.file('content.xml')!.async('string');
    expect(content).toContain('text:style-name="StructureLine"');
  });

  it('declares the table namespace for header/footer region tables — §9', async () => {
    const model = buildProjectsModel([
      {
        label: 'proj',
        files: [
          {
            path: 'src/Main.kt',
            language: 'kotlin',
            highlighted: makeHighlightedFile('src/Main.kt', 'val x = 1\n', '#000000'),
          },
        ],
      },
    ]);
    const result = await odtExporter.export(model, { format: 'odt', filename: 'odt-ns' });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const styles = await zip.file('styles.xml')!.async('string');
    expect(styles).toContain('xmlns:table=');
  });
});
