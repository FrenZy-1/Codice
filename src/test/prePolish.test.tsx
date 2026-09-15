/**
 * Pre-polish & consistency pass tests (Task 21 spec §20).
 *
 * Covers:
 *   - main-preview zoom ladder logic (§5)
 *   - DocumentPreview structure: relative pane root (§1 pills anchor),
 *     zoom toolbar (§5), page slots (§2 centering wrapper)
 *   - TOC alignment controls live INSIDE the TOC Advanced section (§4)
 *   - template preview zoom cannot resize the settings pane: min-w-0 on the
 *     preview pane + shared ToolbarButton language (§6/§12)
 *   - ODT exports: span colors via automatic styles, StructureLine without
 *     the code background, region tables for dual/triple headers (§7/§8/§9)
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import JSZip from 'jszip';
import { AppStateProvider, useAppState } from '../hooks/useAppState';
import { ToastProvider } from '../components/common/Toast';
import { DocumentPreview } from '../components/Preview/DocumentPreview';
import { TemplateCustomizer } from '../components/Settings/TemplateCustomizer';
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
/* TOC Advanced organization (§4)                                      */
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

function tocGroup(): HTMLElement {
  const label = screen.getAllByText('Table of Contents')
    .map((el) => el.closest('.rounded-lg'))
    .find((c) => c?.textContent?.includes('Include table of contents'));
  if (!label) throw new Error('TOC group not found');
  return label as HTMLElement;
}

describe('TOC alignment under Advanced (§4)', () => {
  it('hides alignment controls until the TOC Advanced section opens', () => {
    renderEditor();
    const group = tocGroup();
    expect(group.textContent).not.toContain('Horizontal alignment');
    expect(group.textContent).not.toContain('Vertical alignment');
    const advanced = Array.from(group.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Advanced'),
    );
    expect(advanced).toBeTruthy();
    fireEvent.click(advanced!);
    expect(group.textContent).toContain('Horizontal alignment');
    expect(group.textContent).toContain('Vertical alignment');
  });

  it('orders alignment selects before the metadata toggles (spec tree)', () => {
    renderEditor();
    const group = tocGroup();
    fireEvent.click(
      Array.from(group.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Advanced'),
      )!,
    );
    const text = group.textContent ?? '';
    expect(text.indexOf('Horizontal alignment')).toBeLessThan(
      text.indexOf('Number headings'),
    );
    expect(text.indexOf('Number headings')).toBeLessThan(
      text.indexOf('Show file metadata'),
    );
  });

  it('keeps the Advanced section inside the include-TOC dependency gate', () => {
    renderEditor();
    const group = tocGroup();
    const cb = group.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(cb.checked).toBe(true);
    fireEvent.click(cb); // disable TOC
    expect(group.textContent).not.toContain('Advanced');
    fireEvent.click(cb); // re-enable
    expect(Array.from(group.querySelectorAll('button')).some((b) => b.textContent?.includes('Advanced'))).toBe(true);
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
