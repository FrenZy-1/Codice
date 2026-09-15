/**
 * Component tests for the keyboard shortcuts help overlay.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { HelpDialog, getShortcuts } from '../components/common/HelpDialog';

beforeEach(() => {
  cleanup();
});

describe('getShortcuts', () => {
  it('uses Ctrl on non-Mac platforms', () => {
    const shortcuts = getShortcuts(false);
    const exportShortcut = shortcuts.find((s) => s.label === 'Export document');
    expect(exportShortcut?.keys).toContain('Ctrl');
  });

  it('uses Cmd on Mac platforms', () => {
    const shortcuts = getShortcuts(true);
    const exportShortcut = shortcuts.find((s) => s.label === 'Export document');
    expect(exportShortcut?.keys.join(' ')).toContain('Cmd');
  });

  it('documents every global shortcut', () => {
    const labels = getShortcuts(false).map((s) => s.label);
    expect(labels).toContain('Export document');
    expect(labels).toContain('Toggle template editor');
    expect(labels).toContain('Toggle light / dark theme');
    expect(labels).toContain('Focus file search');
    expect(labels).toContain('Show this help');
  });
});

describe('help dialog', () => {
  it('renders the shortcut list when open', () => {
    render(<HelpDialog open onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    // §23 — the help dialog now opens on the shortcuts TAB.
    expect(screen.getByRole('tab', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Guide — how Codice works' })).toBeTruthy();
    expect(screen.getByText('Export document')).toBeTruthy();
  });

  it('renders nothing when closed', () => {
    render(<HelpDialog open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes via the close button', () => {
    let closed = false;
    render(<HelpDialog open onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(closed).toBe(true);
  });

  it('closes on Escape', () => {
    let closed = false;
    render(<HelpDialog open onClose={() => { closed = true; }} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closed).toBe(true);
  });
});
