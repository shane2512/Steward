// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingState } from '../lib/contracts';

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  onboarding: undefined as unknown,
  replace: vi.fn(),
}));

vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  apiPost: mocks.apiPost,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
// Steps 4 and 5 are the 7.6 signing components; they reach for the wallet.
vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x7a4b704703A90D6e7bc7c89AD166Da405Ced3C8C',
    chainId: 84532,
    connector: { id: 'coinbaseWalletSDK' },
    isConnected: true,
  }),
  useBytecode: () => ({ data: '0x6000', isSuccess: true }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
}));
vi.mock('../lib/useApi', () => ({
  // Only /api/onboarding has canned data here; the signing steps' own reads resolve to undefined.
  useApi: (path: string) => ({
    data: path === '/api/onboarding' ? mocks.onboarding : undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    updatedAt: 1,
    refetch: vi.fn(),
    refreshFailed: false,
  }),
}));

import { OnboardingFlow } from '../components/onboarding/OnboardingFlow';
import { CompileResult, MandateStep } from '../components/onboarding/steps';
import { ApiError } from '../lib/api';

const AGENT = '0xe77C2DcC31444d4D822501B10e58Aa4ab39D8a14';
const state = (o: Partial<OnboardingState>): OnboardingState => ({
  step: 3,
  agentWalletAddress: AGENT,
  mandate: null,
  spendPermissionStatus: null,
  activePolicyVersion: null,
  ...o,
});
const mandate = (sentences: string[]): NonNullable<OnboardingState['mandate']> => ({
  id: 'm',
  text: 't',
  template: 'startup',
  sentences,
  assumptions: [],
  questions: [],
  compiled: true,
});

beforeEach(() => {
  mocks.apiPost.mockReset();
  mocks.replace.mockReset();
});
afterEach(cleanup);

describe('OnboardingFlow resumes from server state', () => {
  it('new owner (no agent wallet): opens on Meet Steward, step 1 of 5', () => {
    mocks.onboarding = state({ step: 2, agentWalletAddress: null });
    render(<OnboardingFlow />);
    expect(screen.getByRole('heading', { name: 'Meet Steward' })).toBeTruthy();
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
  });

  it('returning owner with a wallet resumes on the mandate step', () => {
    mocks.onboarding = state({ step: 3 });
    render(<OnboardingFlow />);
    expect(screen.getByText('Step 3 of 5')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Compile' })).toBeTruthy();
  });

  it('cannot be pushed past the server state by the browser', () => {
    mocks.onboarding = state({ step: 3 });
    render(<OnboardingFlow />);
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('step 4 renders the spend-permission step, and asks for no signature until reviewed', () => {
    mocks.onboarding = state({ step: 4, mandate: mandate(['s']) });
    render(<OnboardingFlow />);
    expect(screen.getByText('Step 4 of 5')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Set the spending limit' })).toBeTruthy();
    expect(screen.getByTestId('spend-limit-sign')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review the limit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in wallet' })).toBeNull();
  });

  it('step 5 renders the policy signing step (its sentences come from the server body)', () => {
    mocks.onboarding = state({
      step: 5,
      spendPermissionStatus: 'pending',
      mandate: mandate(['Keep at least 120,000 USDC liquid.']),
    });
    render(<OnboardingFlow />);
    expect(screen.getByText('Step 5 of 5')).toBeTruthy();
    expect(screen.getByTestId('policy-sign')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review your policy' })).toBeTruthy();
  });

  it('a finished owner is sent to the dashboard', async () => {
    mocks.onboarding = state({ step: 'done', activePolicyVersion: 1 });
    render(<OnboardingFlow />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/app'));
  });
});

describe('MandateStep: compile, review, edit, recompile', () => {
  const noop = () => {};

  it('shows compiled rules as sentences with assumptions and questions', async () => {
    mocks.apiPost.mockResolvedValueOnce({
      compiled: true,
      sentences: [
        'Keep at least 120,000 USDC liquid at all times.',
        'Ask you to approve anything worth 15,000 USDC or more.',
      ],
      issues: [],
      assumptions: ['Steward assumed Fridays are payday.'],
      questions: ['Which vault should hold the rest?'],
      source: 'serv',
      mandateId: 'm1',
    });
    const done = vi.fn();
    render(<MandateStep saved={null} onCompiled={done} onNext={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compile' }));
    await screen.findByText('Keep at least 120,000 USDC liquid at all times.');
    expect(screen.getByText('Steward assumed Fridays are payday.')).toBeTruthy();
    expect(screen.getByText('Which vault should hold the rest?')).toBeTruthy();
    expect(done).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    // the client sends words and a template, never addresses
    expect(mocks.apiPost.mock.calls[0]?.[2]).toEqual({
      text: expect.any(String),
      template: 'startup',
    });
  });

  it('issues are inline with a fix suggestion and block Continue; editing clears the result', async () => {
    mocks.apiPost.mockResolvedValueOnce({
      compiled: false,
      sentences: [],
      issues: [
        {
          path: 'limits.dailyMicroUsd',
          code: 'ABOVE_CEILING',
          message: 'Daily limit is above the system ceiling.',
          suggestion: 'Use 250,000 USDC or less.',
        },
      ],
      assumptions: [],
      questions: [],
      source: 'serv',
      mandateId: 'm2',
    });
    render(<MandateStep saved={null} onCompiled={noop} onNext={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compile' }));
    await screen.findByText('Daily limit is above the system ceiling.');
    expect(screen.getByText(/Use 250,000 USDC or less/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Your mandate'), {
      target: { value: 'Keep 1,000 USDC liquid.' },
    });
    expect(screen.queryByText('Daily limit is above the system ceiling.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Compile' })).toBeTruthy();
  });

  it('cannot compile an empty mandate', () => {
    render(<MandateStep saved={null} onCompiled={noop} onNext={noop} />);
    fireEvent.change(screen.getByLabelText('Your mandate'), { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Compile' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('a server error says nothing moved and keeps the text', async () => {
    mocks.apiPost.mockRejectedValueOnce(new ApiError(500, 'error', 'x'));
    render(<MandateStep saved={null} onCompiled={noop} onNext={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compile' }));
    await screen.findByText(/Nothing moved/);
    expect(
      (screen.getByLabelText('Your mandate') as HTMLTextAreaElement).value.length,
    ).toBeGreaterThan(10);
  });

  it('a template fills the example but never overwrites the owner words', () => {
    render(<MandateStep saved={null} onCompiled={noop} onNext={noop} />);
    const box = screen.getByLabelText('Your mandate') as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: 'DAO' }));
    expect(box.value).toMatch(/500,000 USDC liquid/);
    fireEvent.change(box, { target: { value: 'My own words.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Creator' }));
    expect(box.value).toBe('My own words.');
  });

  it('resumes a saved compiled mandate without recompiling', () => {
    render(
      <MandateStep
        saved={{ ...mandate(['Saved sentence one.']), text: 'Saved text', template: 'custom' }}
        onCompiled={noop}
        onNext={noop}
      />,
    );
    expect(screen.getByText('Saved sentence one.')).toBeTruthy();
    expect((screen.getByLabelText('Your mandate') as HTMLTextAreaElement).value).toBe('Saved text');
  });
});

describe('CompileResult', () => {
  it('renders sentences as text, never as HTML', () => {
    render(
      <CompileResult
        result={{
          compiled: true,
          sentences: ['<img src=x onerror=alert(1)>'],
          issues: [],
          assumptions: [],
          questions: [],
          source: 'serv',
          mandateId: 'x',
        }}
      />,
    );
    expect(document.querySelector('img')).toBeNull();
  });
});
