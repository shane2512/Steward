// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FreezeModal } from '../components/freeze/FreezeModal';
import { FreezeButton } from '../components/shell/AppHeader';
import { Banner, StatusPill } from '../components/ui/primitives';

afterEach(cleanup);

describe('Freeze button (global, DESIGN §5)', () => {
  it('opens the modal instead of acting', () => {
    const open = vi.fn();
    render(<FreezeButton frozen={false} onOpen={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Freeze' }));
    expect(open).toHaveBeenCalledOnce();
  });
  it('becomes a filled, assertive "Frozen" chip once frozen', () => {
    render(<FreezeButton frozen onOpen={() => {}} />);
    const chip = screen.getByText('Frozen');
    expect(chip.getAttribute('aria-live')).toBe('assertive');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Freeze modal shell (flow arrives in 7.8)', () => {
  it('renders nothing when closed', () => {
    render(<FreezeModal open={false} frozen={false} onClose={() => {}} onDone={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('shows the extension-point placeholder and can always be cancelled', () => {
    const close = vi.fn();
    render(<FreezeModal open frozen={false} onClose={close} onDone={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Freeze Steward' })).toBeTruthy();
    expect(screen.getByTestId('freeze-flow-placeholder').textContent).toBe(
      'Freeze flow arrives in task 7.8',
    );
    // the destructive control is inert in the shell: it cannot freeze anything
    expect((screen.getByRole('button', { name: 'Freeze now' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledOnce();
  });
  it('closes on Escape', () => {
    const close = vi.fn();
    render(<FreezeModal open frozen={false} onClose={close} onDone={() => {}} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('Banner + StatusPill live regions', () => {
  it('a frozen or money-stopped banner is assertive, DEMO is polite', () => {
    render(
      <>
        <Banner tone="bad" title="Frozen" live="assertive" id="frozen">
          Steward is stopped.
        </Banner>
        <Banner tone="warn" title="Demo data" id="demo">
          Mocked prices.
        </Banner>
      </>,
    );
    expect(screen.getByText('Steward is stopped.').parentElement?.getAttribute('role')).toBe(
      'alert',
    );
    expect(screen.getByText('Mocked prices.').parentElement?.getAttribute('aria-live')).toBe(
      'polite',
    );
  });
  it('the pill announces politely and carries a word for every state', () => {
    for (const s of ['active', 'waiting', 'frozen', 'breaker', 'safe', 'paused'] as const) {
      const { unmount } = render(<StatusPill state={s} />);
      const pill = screen.getByRole('status');
      expect(pill.getAttribute('aria-live')).toBe('polite');
      expect(pill.textContent?.trim().length).toBeGreaterThan(3); // a word, never a bare dot
      unmount();
    }
  });
});
