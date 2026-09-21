/**
 * Component tests for the Template Editor structure (spec §2, §4, §17).
 *
 * Post WS-2/WS-3 the editors are SPLIT (§16/§17): the Template Editor owns
 * styling only (Typography & Density, Fonts, Theme, Save Preset) while the
 * structural "Page & Layout" settings live in the Layout studio's
 * PageLayoutStudioSection. These tests verify:
 *
 *   - the Template Editor's four top-level sections and NO "Document & Misc"
 *   - Page & Layout (studio) carries the merged page-setup groups while
 *     density/typography stay with the Template Editor
 *   - dependent settings are HIDDEN until the parent feature is enabled
 *     (including the restored WS-6d groups: Title Page, Project Structure,
 *     File Headers, Project Headers, Table of Contents)
 *   - the WS-7b collapsible behavior of those five groups: per-group
 *     expand/collapse headers (aria-expanded/aria-controls), summary chips
 *     that track the state, and master gates that keep working while a
 *     group is collapsed
 *   - code border UI uses enable + solid/dotted/dashed (no 'None' option)
 *   - the eight title-page fields are exposed through the Document Info
 *     dialog (§17 — the single title-page metadata editor)
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent,
  act,
} from '@testing-library/react';
import { AppStateProvider } from '../hooks/useAppState';
import { ToastProvider } from '../components/common/Toast';
import { TemplateCustomizer } from '../components/Settings/TemplateCustomizer';
import { MetadataDialog } from '../components/common/MetadataDialog';
import { CustomLayoutStudio } from '../components/CustomLayout/CustomLayoutStudio';
import { markLayoutTourDone } from '../components/CustomLayout/LayoutOnboarding';
import { createEmptyTemplate } from '../lib/customLayouts/model';

function renderEditor() {
  return render(
    <ToastProvider>
      <AppStateProvider>
        <TemplateCustomizer open onClose={() => {}} />
      </AppStateProvider>
    </ToastProvider>,
  );
}

/**
 * Render the Layout studio with ONE saved template so the File layout editor
 * (and its Page & Layout section) is live. The layout tour is pre-finished so
 * the onboarding overlay never interferes with the queries.
 */
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

/** Open the studio's "Page Settings" tab (§15 — former Page & Layout). */
async function openPageLayout() {
  await act(async () => {
    fireEvent.click(screen.getByRole('tab', { name: 'Page Settings' }));
  });
}

/** Expand/collapse one of the five gated groups inside Page & Layout
 * (WS-7b — the dependents live inside the per-group collapse). */
function toggleGroup(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('editor structure (spec §2)', () => {
  it('shows exactly the four required top-level sections', () => {
    renderEditor();
    expect(screen.getByText('Typography & Density')).toBeTruthy();
    expect(screen.getByText('Fonts Settings')).toBeTruthy();
    expect(screen.getByText('Theme Settings')).toBeTruthy();
    expect(screen.getByText('Save Preset')).toBeTruthy();
    // §17 — the structural Page & Layout settings moved to the Layout
    // studio; the Template Editor owns styling only.
    expect(screen.queryByText('Page & Layout')).toBeNull();
  });

  it('no longer shows a top-level Document & Misc section', () => {
    renderEditor();
    const buttons = screen.getAllByRole('button');
    const sectionButtons = buttons.filter((b) =>
      ['Document & Misc'].includes(b.textContent?.trim() ?? ''),
    );
    expect(sectionButtons).toHaveLength(0);
  });

  it('Page & Layout lives in the Layout studio and contains the merged page-setup groups', async () => {
    renderStudio();
    // Collapsed by default — one click reveals the whole page-setup group.
    await openPageLayout();
    // Page geometry.
    expect(screen.getByLabelText('Page size')).toBeTruthy();
    expect(screen.getByLabelText('Orientation')).toBeTruthy();
    expect(screen.getByLabelText('Page margin Top (mm)')).toBeTruthy();
    expect(screen.getByLabelText('Page margin Left (mm)')).toBeTruthy();
    // Structured header/footer slots (§17 — Page Advanced moved with it).
    expect(screen.getByLabelText(/Show page header/)).toBeTruthy();
    expect(screen.getByLabelText(/Show page footer/)).toBeTruthy();
    // Page breaks, title page and TOC — the former Page & Layout groups.
    expect(screen.getByText('Page breaks')).toBeTruthy();
    expect(screen.getByLabelText('Page break after the title page')).toBeTruthy();
    expect(screen.getByLabelText('Page break before each file')).toBeTruthy();
    expect(screen.getByLabelText('Title page')).toBeTruthy();
    expect(screen.getByLabelText('Table of contents')).toBeTruthy();
    // Restored gated groups (WS-6d): the behavioral master gates for the
    // project structure, file headers and project headers live here too.
    expect(screen.getByLabelText('Include project structure')).toBeTruthy();
    expect(screen.getByLabelText('Show file headers')).toBeTruthy();
    expect(screen.getByLabelText('Show project title')).toBeTruthy();
  });

  it('Document Density and Project Structure stay with the Template Editor (§17 styling split)', () => {
    renderEditor();
    // Density is the (renamed) first section of the Template Editor.
    fireEvent.click(screen.getByText('Typography & Density'));
    expect(screen.getByText('Document Density')).toBeTruthy();
    // Project structure typography lives under Fonts Settings (§7 move),
    // which is expanded by default. The label also appears in the live
    // preview pane — assert presence instead of uniqueness.
    expect(screen.getAllByText('Project Structure').length).toBeGreaterThanOrEqual(1);
  });

  it('Theme Settings contains syntax theme, document colors, and code colors', () => {
    renderEditor();
    fireEvent.click(screen.getByText('Theme Settings'));
    expect(screen.getByText('Syntax Theme')).toBeTruthy();
    expect(screen.getByText('Document Colors')).toBeTruthy();
    expect(screen.getByText('Code Theme / Colors')).toBeTruthy();
  });
});

describe('dependent settings are hidden (spec §4)', () => {
  it('page header slot inputs appear only while the page header is enabled', async () => {
    renderStudio();
    await openPageLayout();
    // The University preset ships WITHOUT a page header → the three slot
    // inputs are hidden (not merely disabled).
    expect(screen.queryByLabelText('Header left text')).toBeNull();
    expect(screen.queryByLabelText('Header center text')).toBeNull();
    expect(screen.queryByLabelText('Header right text')).toBeNull();
    fireEvent.click(screen.getByLabelText(/Show page header/));
    expect(screen.getByLabelText('Header left text')).toBeTruthy();
    expect(screen.getByLabelText('Header center text')).toBeTruthy();
    expect(screen.getByLabelText('Header right text')).toBeTruthy();
    // The enable checkbox itself remains so the feature can be turned back
    // off — and doing so hides the slots again.
    fireEvent.click(screen.getByLabelText(/Show page header/));
    expect(screen.queryByLabelText('Header left text')).toBeNull();
    expect(screen.queryByLabelText('Header right text')).toBeNull();
  });

  it('page footer slot selects and custom text disappear when the footer is off', async () => {
    renderStudio();
    await openPageLayout();
    // The University preset ships WITH a footer → its controls start visible.
    expect(screen.getByLabelText('Footer left slot')).toBeTruthy();
    expect(screen.getByLabelText('Footer center slot')).toBeTruthy();
    expect(screen.getByLabelText('Footer right slot')).toBeTruthy();
    expect(screen.getByLabelText('Footer custom text')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Show page footer/));
    expect(screen.queryByLabelText('Footer left slot')).toBeNull();
    expect(screen.queryByLabelText('Footer center slot')).toBeNull();
    expect(screen.queryByLabelText('Footer right slot')).toBeNull();
    expect(screen.queryByLabelText('Footer custom text')).toBeNull();
    // Re-enabling restores every dependent control.
    fireEvent.click(screen.getByLabelText(/Show page footer/));
    expect(screen.getByLabelText('Footer left slot')).toBeTruthy();
    expect(screen.getByLabelText('Footer custom text')).toBeTruthy();
  });

  it('the header and footer gates hide only their own dependents', async () => {
    renderStudio();
    await openPageLayout();
    // Header on + footer off → header slots stay, footer slots go.
    fireEvent.click(screen.getByLabelText(/Show page header/));
    fireEvent.click(screen.getByLabelText(/Show page footer/));
    expect(screen.getByLabelText('Header left text')).toBeTruthy();
    expect(screen.queryByLabelText('Footer left slot')).toBeNull();
    // And the mirror image: footer on + header off.
    fireEvent.click(screen.getByLabelText(/Show page footer/));
    fireEvent.click(screen.getByLabelText(/Show page header/));
    expect(screen.queryByLabelText('Header left text')).toBeNull();
    expect(screen.getByLabelText('Footer left slot')).toBeTruthy();
  });

  it('title page dependents appear only while the title page is enabled', async () => {
    renderStudio();
    await openPageLayout();
    // Title Page is one of the two groups expanded by default (WS-7b).
    expect(
      screen.getByRole('button', { name: 'Title Page' }).getAttribute('aria-expanded'),
    ).toBe('true');
    // The University preset ships WITH a title page → the eight per-field
    // visibility toggles (§17) and the alignment controls start visible.
    expect(screen.getByLabelText('Show Title on the title page')).toBeTruthy();
    expect(screen.getByLabelText('Show Subtitle on the title page')).toBeTruthy();
    expect(screen.getByLabelText('Show Author on the title page')).toBeTruthy();
    expect(screen.getByLabelText('Show Course on the title page')).toBeTruthy();
    expect(screen.getByLabelText('Show University on the title page')).toBeTruthy();
    expect(screen.getByLabelText('Show Date on the title page')).toBeTruthy();
    expect(screen.getByLabelText('Show Version on the title page')).toBeTruthy();
    expect(screen.getByLabelText('Show Description on the title page')).toBeTruthy();
    expect(screen.getByLabelText('Title page alignment')).toBeTruthy();
    expect(screen.getByLabelText('Title page vertical alignment')).toBeTruthy();
    expect(screen.getByLabelText('Title page vertical offset (pt)')).toBeTruthy();
    // Field VALUES are not duplicated here — the hint points at the
    // Document Info metadata dialog that owns them.
    expect(screen.getByText(/document Metadata dialog/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Title page')); // disable
    // §4 — every dependent control disappears (not merely disabled).
    expect(screen.queryByLabelText('Show Title on the title page')).toBeNull();
    expect(screen.queryByLabelText('Show Description on the title page')).toBeNull();
    expect(screen.queryByLabelText('Title page alignment')).toBeNull();
    expect(screen.queryByLabelText('Title page vertical alignment')).toBeNull();
    expect(screen.queryByLabelText('Title page vertical offset (pt)')).toBeNull();
    // Re-enabling restores the dependents with their values intact.
    fireEvent.click(screen.getByLabelText('Title page'));
    const offset = screen.getByLabelText('Title page vertical offset (pt)') as HTMLInputElement;
    expect(offset.value).toBe('120'); // University preset default
  });

  it('project structure dependents disappear when the structure is disabled', async () => {
    renderStudio();
    await openPageLayout();
    // WS-7b — the group is collapsible and starts collapsed: expand it
    // before asserting its dependent toggles.
    toggleGroup('Project Structure');
    expect(
      screen.getByRole('button', { name: 'Project Structure' }).getAttribute('aria-expanded'),
    ).toBe('true');
    // University preset ships with the structure enabled → dependents visible.
    expect(screen.getByLabelText('Show file sizes')).toBeTruthy();
    expect(screen.getByLabelText('Directories first')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Include project structure')); // off
    expect(screen.queryByLabelText('Show file sizes')).toBeNull();
    expect(screen.queryByLabelText('Directories first')).toBeNull();
    fireEvent.click(screen.getByLabelText('Include project structure')); // on
    expect(screen.getByLabelText('Directories first')).toBeTruthy();
  });

  it('file header detail toggles disappear when file headers are off', async () => {
    renderStudio();
    await openPageLayout();
    // WS-7b — File Headers starts collapsed: expand it first.
    toggleGroup('File Headers');
    expect(screen.getByLabelText('File name')).toBeTruthy();
    expect(screen.getByLabelText('Relative path')).toBeTruthy();
    expect(screen.getByLabelText('Language label')).toBeTruthy();
    expect(screen.getByLabelText('File size')).toBeTruthy();
    expect(screen.getByLabelText('Line count')).toBeTruthy();
    expect(screen.getByLabelText('Bold')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Show file headers')); // off
    expect(screen.queryByLabelText('File name')).toBeNull();
    expect(screen.queryByLabelText('Relative path')).toBeNull();
    expect(screen.queryByLabelText('Bold')).toBeNull();
    fireEvent.click(screen.getByLabelText('Show file headers')); // on
    expect(screen.getByLabelText('Line count')).toBeTruthy();
  });

  it('project header dependents disappear when the project title is off', async () => {
    renderStudio();
    await openPageLayout();
    // WS-7b — Project Headers starts collapsed: expand it first.
    toggleGroup('Project Headers');
    expect(screen.getByLabelText('Show project path')).toBeTruthy();
    expect(screen.getByLabelText('Show project metadata')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Show project title')); // off
    expect(screen.queryByLabelText('Show project path')).toBeNull();
    expect(screen.queryByLabelText('Show project metadata')).toBeNull();
    fireEvent.click(screen.getByLabelText('Show project title')); // on
    expect(screen.getByLabelText('Show project path')).toBeTruthy();
  });

  it('TOC alignment and numbering controls disappear when the TOC is off', async () => {
    renderStudio();
    await openPageLayout();
    // Table of Contents is expanded by default (WS-7b).
    expect(
      screen.getByRole('button', { name: 'Table of Contents' }).getAttribute('aria-expanded'),
    ).toBe('true');
    // University preset ships with a TOC → dependents start visible.
    expect(screen.getByLabelText('TOC horizontal alignment')).toBeTruthy();
    expect(screen.getByLabelText('TOC vertical alignment')).toBeTruthy();
    expect(screen.getByLabelText('Number headings')).toBeTruthy();
    expect(screen.getByLabelText('Show file metadata')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Table of contents')); // off
    expect(screen.queryByLabelText('TOC horizontal alignment')).toBeNull();
    expect(screen.queryByLabelText('TOC vertical alignment')).toBeNull();
    expect(screen.queryByLabelText('Number headings')).toBeNull();
    expect(screen.queryByLabelText('Show file metadata')).toBeNull();
    fireEvent.click(screen.getByLabelText('Table of contents')); // on
    expect(screen.getByLabelText('TOC vertical alignment')).toBeTruthy();
  });

  it('the heading "Numbered" toggle is hidden for the Title level (titles are never numbered)', () => {
    renderEditor();
    // Fonts Settings is expanded by default; Headings starts on H1.
    expect(screen.getByLabelText('Numbered')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Title' }));
    expect(screen.queryByLabelText('Numbered')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'H1' }));
    expect(screen.getByLabelText('Numbered')).toBeTruthy();
  });

  it('code background picker is hidden while the syntax theme background is used', () => {
    renderEditor();
    fireEvent.click(screen.getByText('Theme Settings'));
    expect(screen.queryAllByText('Code background')).toHaveLength(0);
  });
});

describe('Page & Layout collapsible groups (WS-7b)', () => {
  it('Title Page and Table of Contents start expanded; the behavioral groups start collapsed', async () => {
    renderStudio();
    await openPageLayout();
    const defaults: Record<string, string> = {
      'Title Page': 'true',
      'Project Structure': 'false',
      'File Headers': 'false',
      'Project Headers': 'false',
      'Table of Contents': 'true',
    };
    for (const [name, expanded] of Object.entries(defaults)) {
      const btn = screen.getByRole('button', { name });
      expect(btn.getAttribute('aria-expanded')).toBe(expanded);
      // Every group header controls its own content region.
      expect(btn.getAttribute('aria-controls')).toMatch(/^studio-group-/);
    }
    // Clicking a header flips its aria-expanded state both ways.
    const ps = screen.getByRole('button', { name: 'Project Structure' });
    fireEvent.click(ps);
    expect(ps.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(ps);
    expect(ps.getAttribute('aria-expanded')).toBe('false');
  });

  it('summary chips track each group state and flip to "off" with the gate', async () => {
    renderStudio();
    await openPageLayout();
    // University defaults: 7 title-page fields on, dirs-first structure,
    // five file-header details, project metadata, TOC left/top.
    expect(screen.getByText('7 fields on')).toBeTruthy();
    expect(screen.getByText('dirs-first')).toBeTruthy();
    expect(screen.getByText('name, path, lang, size, bold')).toBeTruthy();
    expect(screen.getByText('metadata')).toBeTruthy();
    expect(screen.getByText('left · top')).toBeTruthy();
    // Gate off → the chip flips to "off"; re-enable → the summary returns.
    fireEvent.click(screen.getByLabelText('Include project structure'));
    expect(screen.getByText('off')).toBeTruthy();
    expect(screen.queryByText('dirs-first')).toBeNull();
    fireEvent.click(screen.getByLabelText('Include project structure'));
    expect(screen.getByText('dirs-first')).toBeTruthy();
    expect(screen.queryByText('off')).toBeNull();
    // Dependent toggles update the chip live once the group is expanded.
    toggleGroup('Project Structure');
    fireEvent.click(screen.getByLabelText('Show file sizes')); // on
    expect(screen.getByText('sizes, dirs-first')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Directories first')); // off
    expect(screen.getByText('sizes')).toBeTruthy();
  });

  it('the master gate keeps working while a group is collapsed (§4)', async () => {
    renderStudio();
    await openPageLayout();
    // File Headers starts collapsed — its chip still summarizes the preset.
    expect(screen.getByText('name, path, lang, size, bold')).toBeTruthy();
    // Gate off while collapsed: dependents unmount, chip shows "off".
    fireEvent.click(screen.getByLabelText('Show file headers'));
    expect(screen.getByText('off')).toBeTruthy();
    // Gate on while collapsed: the chip summary returns, group stays closed.
    fireEvent.click(screen.getByLabelText('Show file headers'));
    expect(screen.getByText('name, path, lang, size, bold')).toBeTruthy();
    const fh = screen.getByRole('button', { name: 'File Headers' });
    expect(fh.getAttribute('aria-expanded')).toBe('false');
    // Expanding afterwards reveals the detail toggles.
    fireEvent.click(fh);
    expect(fh.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('File name')).toBeTruthy();
  });

  it('aria-controls resolves to the content region, unmounted while gated off', async () => {
    renderStudio();
    await openPageLayout();
    const ps = screen.getByRole('button', { name: 'Project Structure' });
    const cid = ps.getAttribute('aria-controls')!;
    // Gate on (even collapsed) → the content region exists in the DOM.
    expect(document.getElementById(cid)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Include project structure'));
    // §4 — the dependents are unmounted while the gate is off.
    expect(document.getElementById(cid)).toBeNull();
    fireEvent.click(screen.getByLabelText('Include project structure'));
    expect(document.getElementById(cid)).toBeTruthy();
  });
});

describe('code border control (spec §27)', () => {
  it('uses an enable checkbox plus solid/dotted/dashed styles (no None)', () => {
    renderEditor();
    fireEvent.click(screen.getByText('Theme Settings'));
    const enable = screen.getByLabelText('Enable border') as HTMLInputElement;
    // University preset ships with a border enabled → toggle off and on so
    // the enabled-state controls render from a clean state.
    fireEvent.click(enable); // off
    expect(screen.queryByLabelText('Border style')).toBeNull();
    fireEvent.click(enable); // on
    const styleSelect = screen.getByLabelText('Border style') as HTMLSelectElement;
    const values = Array.from(styleSelect.options).map((o) => o.value);
    expect(values).toEqual(['solid', 'dotted', 'dashed']);
    expect(values).not.toContain('none');
  });

  it('unchecking Enable border removes the style picker entirely', () => {
    renderEditor();
    fireEvent.click(screen.getByText('Theme Settings'));
    // University preset ships with a solid border → checkbox starts checked.
    expect((screen.getByLabelText('Enable border') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Enable border'));
    expect(screen.queryByLabelText('Border style')).toBeNull();
  });
});

describe('preview toolbar (zoom + page navigation)', () => {
  it('renders zoom controls and page navigation', () => {
    renderEditor();
    expect(screen.getByTitle('Fit to width')).toBeTruthy();
    expect(screen.getByLabelText('Zoom in')).toBeTruthy();
    expect(screen.getByLabelText('Zoom out')).toBeTruthy();
    expect(screen.getByLabelText('Previous page')).toBeTruthy();
    expect(screen.getByLabelText('Next page')).toBeTruthy();
    expect(screen.getByText(/Page \d+ \/ \d+/)).toBeTruthy();
  });

  it('next/previous page buttons update the page indicator', () => {
    renderEditor();
    const before = screen.getByText(/Page \d+ \/ \d+/).textContent;
    fireEvent.click(screen.getByLabelText('Next page'));
    const after = screen.getByText(/Page \d+ \/ \d+/).textContent;
    expect(after).not.toBe(before);
    expect(Number(after!.match(/Page (\d+)/)![1])).toBeGreaterThan(
      Number(before!.match(/Page (\d+)/)![1]),
    );
  });
});

describe('title page fields (spec §17)', () => {
  it('exposes inputs for all eight title-page fields (Document Info dialog)', () => {
    render(
      <ToastProvider>
        <AppStateProvider>
          <MetadataDialog open onClose={() => {}} />
        </AppStateProvider>
      </ToastProvider>,
    );
    // §17 — since the WS-2/WS-3 re-homing the eight title-page metadata
    // fields are edited in ONE place: the top bar's Document Info dialog.
    // The dialog labels itself as the title-page metadata editor.
    expect(screen.getByText('title page metadata')).toBeTruthy();
    expect(screen.getByPlaceholderText('Project Report')).toBeTruthy(); // title
    expect(screen.getByPlaceholderText('A practical guide…')).toBeTruthy(); // subtitle
    expect(screen.getByPlaceholderText('Jane Doe')).toBeTruthy(); // author
    expect(screen.getByPlaceholderText('CS 402 — Software Engineering')).toBeTruthy(); // course
    expect(screen.getByPlaceholderText('State University')).toBeTruthy(); // university
    expect(screen.getByPlaceholderText('(today)')).toBeTruthy(); // date
    expect(screen.getByPlaceholderText('v1.0.0')).toBeTruthy(); // version
    expect(screen.getByPlaceholderText('Short description of the document…')).toBeTruthy(); // description
  });

  it('points at the Layout studio for per-field title-page visibility', () => {
    render(
      <ToastProvider>
        <AppStateProvider>
          <MetadataDialog open onClose={() => {}} />
        </AppStateProvider>
      </ToastProvider>,
    );
    // WS-6d — the stale "Template → Page & Layout → Title Page" tip was
    // re-pointed at the real location: the Layout studio's Page & Layout
    // → Title Page visibility toggles (the Template editor no longer has
    // a Page & Layout section).
    expect(screen.getByText(/Layout studio/)).toBeTruthy();
    expect(screen.queryByText(/Template →/)).toBeNull();
  });
});
