import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../components/common/Toast';

/** Helper component that exposes the toast API. */
function ToastConsumer() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.push({ kind: 'success', title: 'Success toast' })}>
        push-success
      </button>
      <button onClick={() => toast.push({ kind: 'error', title: 'Error toast' })}>
        push-error
      </button>
      <button
        onClick={() =>
          toast.push({ kind: 'success', title: 'Custom duration', durationMs: 50 })
        }
      >
        push-short
      </button>
    </div>
  );
}

describe('Toast system', () => {
  it('renders without crashing', () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>,
    );
    expect(screen.getByText('push-success')).toBeInTheDocument();
  });

  it('shows a toast when pushed', () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText('push-success').click();
    });
    expect(screen.getByText('Success toast')).toBeInTheDocument();
  });

  it('supports success and error kinds', () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText('push-success').click();
    });
    expect(screen.getByText('Success toast')).toBeInTheDocument();
    act(() => {
      screen.getByText('push-error').click();
    });
    expect(screen.getByText('Error toast')).toBeInTheDocument();
  });

  it('auto-dismisses after the configured duration', async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText('push-short').click();
    });
    expect(screen.getByText('Custom duration')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByText('Custom duration')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('can be manually dismissed via the close button', () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText('push-success').click();
    });
    expect(screen.getByText('Success toast')).toBeInTheDocument();
    const dismissBtn = screen.getByLabelText('Dismiss notification');
    act(() => {
      dismissBtn.click();
    });
    expect(screen.queryByText('Success toast')).not.toBeInTheDocument();
  });
});
