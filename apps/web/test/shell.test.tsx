// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 7.8: the modal now contains the real flow, which reads GET /api/freeze and talks to a wallet.
// The flow's own behaviour is tested in freezeFlow.test.tsx; here it only has to mount.
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  apiGet: vi.fn(() => new Promise(() => undefined)),
  apiPost: vi.fn(),
}));
vi.mock('wagmi', () => ({
  useAccount: () => ({ isConnected: false }),
  useBytecode: () => ({ data: undefined, isSuccess: false }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
  useSendTransaction: () => ({ sendTransactionAsync: vi.fn() }),
}));

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
  // 7.8: the frozen state stays a BUTTON. Freezing is step 1 of three, so an owner who froze and
  // closed the modal must be able to reopen it and finish revoking and sweeping (D-96).
  it('becomes a filled, assertive "Frozen" control that still opens the flow', () => {
    const open = vi.fn();
    render(<FreezeButton frozen onOpen={open} />);
    const chip = screen.getByRole('button', { name: 'Frozen' });
    expect(chip.getAttribute('aria-live')).toBe('assertive');
    fireEvent.click(chip);
    expect(open).toHaveBeenCalledOnce();
  });
});

describe('Freeze modal shell', () => {
  it('renders nothing when closed', () => {
    render(<FreezeModal open={false} frozen={false} onClose={() => {}} onDone={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('can always be cancelled, even before the flow knows anything', () => {
    const close = vi.fn();
    render(<FreezeModal open frozen={false} onClose={close} onDone={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Freeze Steward' })).toBeTruthy();
    // The status read is still in flight here, so the flow shows what it is doing rather than
    // guessing which step is live (D-95). Cancel is never blocked by that fetch.
    expect(screen.getByTestId('freeze-loading').textContent).toContain('Checking');
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
