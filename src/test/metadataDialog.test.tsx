/**
 * Component tests for the document metadata quick-edit dialog.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { AppStateProvider } from '../hooks/useAppState';
import { ToastProvider } from '../components/common/Toast';
import { MetadataDialog } from '../components/common/MetadataDialog';

function renderDialog() {
  return render(
    <ToastProvider>
      <AppStateProvider>
        <MetadataDialog open onClose={() => {}} />
      </AppStateProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('metadata dialog', () => {
  it('renders all eight metadata fields', () => {
    renderDialog();
    for (const label of ['Title', 'Subtitle', 'Author', 'Course', 'University', 'Date', 'Version', 'Description']) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('seeds the title from the current metadata and saves changes', () => {
    renderDialog();
    const title = screen.getByPlaceholderText('Project Report') as HTMLInputElement;
    expect(title.value).toBe('Project Report');
    fireEvent.change(title, { target: { value: 'Renamed Document' } });
    fireEvent.click(screen.getByText('Save'));
    // A success toast confirms the save.
    expect(screen.getByText('Document info saved')).toBeTruthy();
  });

  it('cancel does not show the save toast', () => {
    renderDialog();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Document info saved')).toBeNull();
  });

  it('renders nothing when closed', () => {
    render(
      <ToastProvider>
        <AppStateProvider>
          <MetadataDialog open={false} onClose={() => {}} />
        </AppStateProvider>
      </ToastProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
