// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectView } from '../components/connect/ConnectView';
import {
  classifyConnectError,
  connectCopy,
  connectReducer,
  initialConnectState,
  type ConnectEvent,
  type ConnectState,
} from '../lib/connectMachine';

afterEach(cleanup);

const run = (events: ConnectEvent[], from: ConnectState = initialConnectState) =>
  events.reduce(connectReducer, from);

describe('connect state machine', () => {
  it('happy path on the right network', () => {
    expect(
      run([
        { type: 'connect' },
        { type: 'connected', chainId: 84532 },
        { type: 'verify' },
        { type: 'done' },
      ]),
    ).toEqual({ step: 'signed_in' });
  });

  it('wrong network goes through switching before signing', () => {
    const s1 = run([{ type: 'connect' }, { type: 'connected', chainId: 8453 }]);
    expect(s1).toEqual({ step: 'wrong_network', chainId: 8453 });
    expect(run([{ type: 'switch' }], s1)).toEqual({ step: 'switching' });
    expect(run([{ type: 'switch' }, { type: 'switched' }], s1)).toEqual({ step: 'signing' });
  });

  it('never reaches signing on a wrong chain without a switch', () => {
    const s = run([
      { type: 'connect' },
      { type: 'connected', chainId: 1 },
      { type: 'sign' },
      { type: 'verify' },
    ]);
    expect(s.step).toBe('wrong_network');
  });

  it('a rejected signature can be retried', () => {
    const rejected = run([
      { type: 'connect' },
      { type: 'connected', chainId: 84532 },
      { type: 'fail', reason: 'rejected', at: 'sign' },
    ]);
    expect(rejected).toEqual({ step: 'rejected', at: 'sign' });
    expect(run([{ type: 'sign' }], rejected)).toEqual({ step: 'signing' });
  });

  it('a rejected connection retries from the start', () => {
    const r = run([{ type: 'connect' }, { type: 'fail', reason: 'rejected', at: 'connect' }]);
    expect(run([{ type: 'connect' }], r)).toEqual({ step: 'connecting' });
  });

  it('an unsupported wallet is terminal until reset (no silent retry)', () => {
    const u = run([{ type: 'connect' }, { type: 'fail', reason: 'unsupported', at: 'connect' }]);
    expect(u).toEqual({ step: 'unsupported' });
    expect(run([{ type: 'connect' }], u)).toEqual({ step: 'unsupported' });
    expect(run([{ type: 'reset' }], u)).toEqual(initialConnectState);
  });

  it('ignores events that do not apply (cannot wedge the screen)', () => {
    expect(run([{ type: 'done' }, { type: 'switched' }, { type: 'verify' }])).toEqual(
      initialConnectState,
    );
  });

  it('a server failure while verifying becomes a retryable error', () => {
    const s = run([
      { type: 'connect' },
      { type: 'connected', chainId: 84532 },
      { type: 'verify' },
      { type: 'fail', reason: 'other', at: 'verify', message: 'x' },
    ]);
    expect(s).toEqual({ step: 'error', message: 'x' });
    expect(run([{ type: 'connect' }], s)).toEqual({ step: 'connecting' });
  });
});

describe('classifyConnectError', () => {
  it('sorts wallet errors into the three outcomes', () => {
    expect(classifyConnectError({ code: 4001 })).toBe('rejected');
    expect(
      classifyConnectError(Object.assign(new Error('x'), { name: 'UserRejectedRequestError' })),
    ).toBe('rejected');
    expect(classifyConnectError(new Error('User denied message signature'))).toBe('rejected');
    expect(classifyConnectError(new Error('Smart wallet is not supported here'))).toBe(
      'unsupported',
    );
    expect(classifyConnectError(new Error('boom'))).toBe('other');
    expect(classifyConnectError(undefined)).toBe('other');
  });
});

describe('ConnectView', () => {
  it('idle: one primary action, testnet chip, no status message', () => {
    const connect = vi.fn();
    render(<ConnectView state={initialConnectState} onConnect={connect} onRetry={() => {}} />);
    expect(screen.getByText('Testnet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));
    expect(connect).toHaveBeenCalledOnce();
  });

  it('every non-idle state renders its own copy', () => {
    const states: ConnectState[] = [
      { step: 'connecting' },
      { step: 'wrong_network', chainId: 8453 },
      { step: 'switching' },
      { step: 'signing' },
      { step: 'verifying' },
      { step: 'rejected', at: 'sign' },
      { step: 'unsupported' },
      { step: 'error', message: 'It broke. Nothing moved.' },
    ];
    for (const s of states) {
      const { unmount } = render(<ConnectView state={s} onConnect={() => {}} onRetry={() => {}} />);
      expect(screen.getByText(connectCopy(s)?.title ?? 'missing')).toBeTruthy();
      unmount();
    }
  });

  it('busy states disable the button (no double connect)', () => {
    render(<ConnectView state={{ step: 'connecting' }} onConnect={() => {}} onRetry={() => {}} />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('rejected: says nothing moved and offers Try again', () => {
    const retry = vi.fn();
    render(
      <ConnectView state={{ step: 'rejected', at: 'sign' }} onConnect={() => {}} onRetry={retry} />,
    );
    expect(screen.getByText(/Nothing was signed and nothing moved/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('unsupported: explains why in plain words (D-5) and is announced as an alert', () => {
    render(<ConnectView state={{ step: 'unsupported' }} onConnect={() => {}} onRetry={() => {}} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Coinbase Smart Wallet/);
    expect(alert.textContent).toMatch(/cannot grant the capped spend permission/);
  });
});
