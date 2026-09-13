/**
 * Component tests for the Template Editor structure (spec §2, §4).
 *
 * Verifies:
 *   - exactly four top-level sections (Page & Layout, Fonts Settings,
 *     Theme Settings, Save Preset) and no "Document & Misc"
 *   - dependent settings are HIDDEN until the parent feature is enabled
 *   - code border UI uses enable + solid/dotted/dashed (no 'None' option)
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { AppStateProvider } from '../hooks/useAppState';
import { ToastProvider } from '../components/common/Toast';
import { TemplateCustomizer } from '../components/Settings/TemplateCustomizer';

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
 * Open the "Advanced ▼" region of the group with the given label.
 * Advanced controls are hidden until expanded — mirrors real usage.
 */
function openAdvanced(groupLabel: string) {
  const labelEl = screen
    .getAllByText(groupLabel)
    .map((el) => el.closest('.rounded-lg'))
    .find((container) => container?.querySelector('button'));
  if (!labelEl) throw new Error(`Group not found: ${groupLabel}`);
  const advancedBtn = Array.from(labelEl.querySelectorAll('button')).find(
    (b) => b.textContent?.includes('Advanced'),
  );
  if (advancedBtn) fireEvent.click(advancedBtn);
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('editor structure (spec §2)', () => {
  it('shows exactly the four required top-level sections', () => {
    renderEditor();
    expect(screen.getByText('Page & Layout')).toBeTruthy();
    expect(screen.getByText('Fonts Settings')).toBeTruthy();
    expect(screen.getByText('Theme Settings')).toBeTruthy();
    expect(screen.getByText('Save Preset')).toBeTruthy();
  });

  it('no longer shows a top-level Document & Misc section', () => {
    renderEditor();
    const buttons = screen.getAllByRole('button');
    const sectionButtons = buttons.filter((b) =>
      ['Document & Misc'].includes(b.textContent?.trim() ?? ''),
    );
    expect(sectionButtons).toHaveLength(0);
  });

  it('Page & Layout contains the merged document groups', () => {
    renderEditor();
    // Several labels appear twice (Page & Layout group + Fonts Settings
    // typography group) — assert presence instead of uniqueness.
    for (const label of [
      'Title Page',
      'Project Structure',
      'File Headers',
      'Project Headers',
      'Table of Contents',
      'Code Behavior',
      'Document Density',
      'Page Breaks',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
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
  it('title page controls disappear when the feature is disabled', () => {
    renderEditor();
    openAdvanced('Title Page');
    expect(screen.getByPlaceholderText('Project Report')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Include title page'));
    // Hidden — not merely disabled. (The enable checkbox itself remains so
    // the feature can be turned back on.)
    expect(screen.getByLabelText('Include title page')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Project Report')).toBeNull();
    expect(screen.queryByPlaceholderText('Jane Doe')).toBeNull();
  });

  it('file header detail toggles disappear when file headers are off', () => {
    renderEditor();
    openAdvanced('File Headers');
    expect(screen.getByLabelText('File name')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Show file headers'));
    expect(screen.queryByLabelText('File name')).toBeNull();
    expect(screen.queryByLabelText('Relative path')).toBeNull();
    expect(screen.queryByLabelText('Line count')).toBeNull();
  });

  it('project header path/metadata disappear when the title toggle is off', () => {
    renderEditor();
    openAdvanced('Project Headers');
    expect(screen.getByLabelText('Show project path')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Show project title'));
    expect(screen.queryByLabelText('Show project path')).toBeNull();
    expect(screen.queryByLabelText('Show metadata')).toBeNull();
  });

  it('TOC options disappear when the TOC is disabled', () => {
    renderEditor();
    openAdvanced('Table of Contents');
    expect(screen.getByLabelText('Number headings')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Include table of contents'));
    expect(screen.queryByLabelText('Number headings')).toBeNull();
    expect(screen.queryByLabelText('Show file metadata')).toBeNull();
  });

  it('code background picker is hidden while the syntax theme background is used', () => {
    renderEditor();
    fireEvent.click(screen.getByText('Theme Settings'));
    expect(screen.queryAllByText('Code background')).toHaveLength(0);
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
  it('exposes inputs for all eight title-page fields', () => {
    renderEditor();
    openAdvanced('Title Page');
    expect(screen.getByPlaceholderText('Project Report')).toBeTruthy(); // title
    expect(screen.getByPlaceholderText('A Practical Guide…')).toBeTruthy(); // subtitle
    expect(screen.getByPlaceholderText('Jane Doe')).toBeTruthy(); // author
    expect(screen.getByPlaceholderText('CS 402')).toBeTruthy(); // course
    expect(screen.getByPlaceholderText('State University')).toBeTruthy(); // university
    expect(screen.getByPlaceholderText('(today)')).toBeTruthy(); // date
    expect(screen.getByPlaceholderText('v1.0.0')).toBeTruthy(); // version
    expect(screen.getByPlaceholderText('Short description…')).toBeTruthy(); // description
  });
});
