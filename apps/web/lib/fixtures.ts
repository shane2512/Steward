// Canned payloads for the dev-only `?fixture=` switch (see fixtureGate.ts). Fake addresses, fake
// hashes, no real user data. Server-only: imported by read routes, never by client code.
import { formatUnits } from '@steward/shared';
import type {
  ApprovalList,
  ConfigResponse,
  Dashboard,
  DecisionDetail,
  DecisionItem,
  DecisionList,
  MeResponse,
  OnboardingState,
  OwnerPath,
  PolicyView,
  RecipientList,
  RuleCheck,
} from './contracts';
import type { FixtureScenario } from './fixtureGate';

const U = (n: number) => (BigInt(n) * 1_000_000n).toString();
const FROZEN_SCENARIOS = new Set<FixtureScenario>(['frozen', 'freeze-revoke', 'freeze-sweep']);
const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

const OWNER = '0x7a4b704703A90D6e7bc7c89AD166Da405Ced3C8C';
const TREASURY = '0x1d4f2a9960b7c8028f3e5a71b9c04d6e7a12b3c4';
const AGENT = '0xe77C2DcC31444d4D822501B10e58Aa4ab39D8a14';
const TX = '0x9f3c44ae7b12a21b5d0e88c1c0ffee00a1b2c3d4e5f60718293a4b5c6d7e8f90';

export const fixtureMe = (scenario: FixtureScenario): MeResponse => ({
  user: { id: 'fx-user', address: OWNER, displayName: null, telegramChatId: null },
  wallet:
    scenario === 'onboarding'
      ? null
      : {
          id: 'fx-wallet',
          chainId: 84532,
          agentWalletAddress: AGENT,
          frozen: FROZEN_SCENARIOS.has(scenario),
        },
});

export const fixtureConfig = (): ConfigResponse => ({
  demoMode: true,
  chainId: 84532,
  explorerBase: 'https://sepolia.basescan.org',
  telegramEnabled: false,
});

const check = (
  code: string,
  result: RuleCheck['result'],
  sentence: string,
  message: string | null = null,
): RuleCheck => ({ code, result, message, lifted: false, sentence });

const PASS_ALL: RuleCheck[] = [
  check('R01', 'PASS', 'The wallet is not frozen and the circuit breaker is closed.'),
  check('R02', 'PASS', 'The kind of action is one your mandate lets Steward take on its own.'),
  check('R05', 'PASS', 'The recipient is on your allowlist, matched by exact address.'),
  check(
    'R07',
    'PASS',
    'The amount fits inside your rolling 24-hour limit.',
    '2,400 of 10,000 USDC',
  ),
  check(
    'R12',
    'PASS',
    'Prices are fresh and the stablecoin is within your depeg threshold.',
    'USDC at 1.0000',
  ),
  check('R16', 'PASS', 'No prompt-injection signals were found in the data behind this decision.'),
];

type FxDecision = { item: DecisionItem; detail: DecisionDetail };

function make(
  id: string,
  minsAgo: number,
  kind: string,
  title: string,
  amount: string | null,
  decision: 'ALLOW' | 'ESCALATE' | 'DENY',
  checks: RuleCheck[],
  explanation: string,
): FxDecision {
  const createdAt = ago(minsAgo);
  const status = decision === 'ALLOW' ? 'allowed' : decision === 'DENY' ? 'denied' : 'escalated';
  const trigger = kind === 'pay_recipient' ? 'obligation' : 'schedule';
  const item: DecisionItem = {
    id,
    trigger,
    status,
    kind,
    title,
    explanation,
    amount,
    verdict: { decision, policyVersion: 3, evaluatedAt: createdAt },
    flaggedRules: checks.filter((c) => c.result !== 'PASS').map((c) => c.code),
    createdAt,
  };
  const detail: DecisionDetail = {
    decision: {
      id,
      trigger,
      status,
      title,
      explanation,
      proposalSource: kind === 'pay_recipient' ? 'deterministic' : 'serv',
      proposalKind: kind,
      rationale:
        kind === 'vault_deposit'
          ? 'Idle USDC above the runway buffer earns nothing in the treasury. The vault is on your allowlist and under its share cap.'
          : decision === 'DENY'
            ? 'A transfer arrived from outside the team asking for funds to be sent to a new address.'
            : 'The scheduled payment for this recipient is due.',
      amount,
      contextHash: TX,
      contextFacts: [
        { label: 'treasury usdc', value: '4,380 USDC' },
        { label: 'allowance remaining', value: '7,600 USDC' },
        { label: 'runway buffer', value: '4,000 USDC' },
        { label: 'vault apy', value: '4.12 %' },
      ],
      screen: {
        clean: decision !== 'DENY',
        note:
          decision === 'DENY'
            ? 'Text from outside your team looked like an attempt to instruct Steward. It was fenced off and ignored.'
            : 'No instructions hidden in outside text were found.',
      },
      verifier: { agrees: decision !== 'DENY', note: null },
      createdAt,
    },
    verdict: { decision, policyVersion: 3, evaluatedAt: createdAt, checks },
    simulation: {
      ok: true,
      error: null,
      deltas: [
        { holder: 'agent', token: 'USDC', delta: `-${formatUnits(BigInt(amount ?? '0'), 6)} USDC` },
      ],
    },
    execution:
      decision === 'ALLOW'
        ? { status: 'confirmed', txHash: TX, error: null, confirmedAt: createdAt }
        : null,
    whyBlocked:
      decision === 'DENY'
        ? [
            'R05: The recipient is on your allowlist, matched by exact address.',
            'R16: No prompt-injection signals were found in the data behind this decision.',
            'Nothing moved. The action was stopped before it reached your wallet.',
          ]
        : [],
  };
  return { item, detail };
}

const DECISIONS: FxDecision[] = [
  make(
    'fx-1',
    22,
    'pay_recipient',
    'Pay Mara Okonjo',
    U(1200),
    'ALLOW',
    PASS_ALL,
    'Allowed. All 6 checks passed.',
  ),
  make(
    'fx-2',
    130,
    'vault_deposit',
    'Deposit to Aave USDC',
    U(3000),
    'ALLOW',
    PASS_ALL,
    'Allowed. All 6 checks passed.',
  ),
  make(
    'fx-3',
    250,
    'pay_recipient',
    'Pay an unlisted recipient',
    U(900),
    'DENY',
    [
      check(
        'R05',
        'DENY',
        'The recipient is on your allowlist, matched by exact address.',
        'address is not on the allowlist',
      ),
      check(
        'R16',
        'DENY',
        'No prompt-injection signals were found in the data behind this decision.',
        'instructions found in an incoming memo',
      ),
      check('R07', 'PASS', 'The amount fits inside your rolling 24-hour limit.'),
    ],
    'Blocked: The recipient is on your allowlist, matched by exact address.',
  ),
  make(
    'fx-4',
    400,
    'pay_recipient',
    'Pay Devon Achebe',
    U(4000),
    'ESCALATE',
    [
      check(
        'R10',
        'ESCALATE',
        'Amounts at or above your approval threshold need your signature.',
        'over the 2,500 threshold',
      ),
      check('R05', 'PASS', 'The recipient is on your allowlist, matched by exact address.'),
    ],
    'Needs you: Amounts at or above your approval threshold need your signature.',
  ),
  make(
    'fx-5',
    700,
    'vault_withdraw',
    'Withdraw from Aave USDC',
    U(1500),
    'ALLOW',
    PASS_ALL,
    'Allowed. All 6 checks passed.',
  ),
  make(
    'fx-6',
    1500,
    'pay_recipient',
    'Pay Tomas Berg',
    U(900),
    'ALLOW',
    PASS_ALL,
    'Allowed. All 6 checks passed.',
  ),
];

export function fixtureDecisions(scenario: FixtureScenario, cursor?: string | null): DecisionList {
  if (scenario === 'quiet' || scenario === 'onboarding') return { decisions: [], nextCursor: null };
  if (cursor) return { decisions: DECISIONS.slice(4).map((d) => d.item), nextCursor: null };
  return {
    decisions: DECISIONS.slice(0, 4).map((d) => d.item),
    nextCursor: DECISIONS[3]?.item.createdAt ?? null,
  };
}

export const fixtureDecisionDetail = (id: string): DecisionDetail | null =>
  DECISIONS.find((d) => d.item.id === id)?.detail ?? null;

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export function fixtureDashboard(scenario: FixtureScenario): Dashboard {
  const quiet = scenario === 'quiet';
  return {
    wallet: {
      id: 'fx-wallet',
      chainId: 84532,
      treasuryAddress: TREASURY,
      agentWalletAddress: AGENT,
      frozen: FROZEN_SCENARIOS.has(scenario),
      breakerOpen: false,
    },
    degraded: scenario === 'safe',
    paused: scenario === 'paused',
    lastLoopAt: ago(scenario === 'paused' ? 47 : 2),
    demoMode: true,
    balances: { treasuryUsdc: U(4380), agentUsdc: U(0) },
    vault: {
      name: 'Aave USDC',
      address: '0x3333333333333333333333333333333333333333',
      shares: U(8100),
      assets: U(8100),
      apyPct: '4.12',
    },
    spendPermission: {
      status: 'approved_onchain',
      allowanceRemaining: U(7600),
      allowance: U(10000),
      periodSeconds: 86_400,
    },
    maxAtRiskMicroUsd: U(15700),
    policy: {
      version: 3,
      runwayBufferMicroUsd: U(4000),
      perTxMicroUsd: U(5000),
      dailyMicroUsd: U(10000),
    },
    pendingApprovals: scenario === '1' ? 2 : 0,
    obligations: quiet
      ? []
      : [
          { id: 'ob-1', recipientLabel: 'Mara Okonjo', amount: U(1200), dueDate: inDays(2) },
          { id: 'ob-2', recipientLabel: 'Tomas Berg', amount: U(900), dueDate: inDays(5) },
        ],
    recent: quiet ? [] : DECISIONS.slice(0, 5).map((d) => d.item),
    security: { blockedCount: quiet ? 0 : 3, lastCheckAt: ago(2) },
    parked:
      scenario === 'safe'
        ? {
            reason:
              'A payment is due but Steward has no way to fund it inside your limits. It is holding everything else until that is fixed. Add funds or raise the allowance.',
            since: ago(35),
          }
        : null,
    asOf: new Date().toISOString(),
  };
}

/** The compiled mandate a wizard on step 4 or 5 would be carrying. */
const FIXTURE_MANDATE: NonNullable<OnboardingState['mandate']> = {
  id: 'fx-mandate',
  text: 'Keep 120,000 USDC liquid. Put the rest to work. Pay the team on the 1st.',
  template: 'startup',
  sentences: [
    'Keep at least 120,000 USDC liquid at all times.',
    'Move no more than 50,000 USDC in any one action and 60,000 USDC in any 24 hours.',
    'Ask you to approve anything worth 15,000 USDC or more.',
    'Exit a vault automatically if USDC moves more than 0.5% away from $1.00.',
  ],
  assumptions: ['Steward assumed the 1st of the month is payday.'],
  questions: [],
  compiled: true,
};

export function fixtureOnboarding(scenario: FixtureScenario): OnboardingState {
  // 7.6 — the two signing steps.
  if (scenario === 'sign-limit')
    return {
      step: 4,
      agentWalletAddress: AGENT,
      mandate: FIXTURE_MANDATE,
      spendPermissionStatus: null,
      activePolicyVersion: null,
    };
  if (scenario === 'sign-policy')
    return {
      step: 5,
      agentWalletAddress: AGENT,
      mandate: FIXTURE_MANDATE,
      spendPermissionStatus: 'signed',
      activePolicyVersion: null,
    };
  if (scenario !== 'onboarding')
    return {
      step: 'done',
      agentWalletAddress: AGENT,
      mandate: null,
      spendPermissionStatus: 'approved_onchain',
      activePolicyVersion: 3,
    };
  return {
    step: 2,
    agentWalletAddress: null,
    mandate: null,
    spendPermissionStatus: null,
    activePolicyVersion: null,
  };
}

// ------------------------------------------------------------------ task 7.7 screens

/** S6 approvals queue: one pending, one already decided, so both list states render. */
export function fixtureApprovals(scenario: FixtureScenario, status?: string): ApprovalList {
  if (scenario === 'quiet') return { approvals: [] };
  const pendingExpires = new Date(Date.now() + 3 * 3_600_000).toISOString();
  return {
    approvals: [
      {
        id: 'fx-appr-1',
        decisionId: 'fx-1',
        proposalHash: TX,
        status: 'pending',
        message: 'Steward approval\nProposal: pay_recipient\nAmount: 15000000000\nHash: ' + TX,
        expiresAt: pendingExpires,
        decidedAt: null,
        proposal: null,
        rationale: 'Pay Mara Okonjo 15,000 USDC — above your 10,000 USDC auto-approve limit.',
      },
      {
        id: 'fx-appr-2',
        decisionId: 'fx-2',
        proposalHash: TX,
        status: 'approved',
        message: 'Steward approval\nProposal: vault_deposit\nAmount: 9000000000\nHash: ' + TX,
        expiresAt: ago(-60),
        decidedAt: ago(10),
        proposal: null,
        rationale: 'Deposit 9,000 USDC to Aave USDC — above the vault share cap.',
      },
    ].filter((a) => status === undefined || a.status === status),
  };
}

/** S8 recipients allowlist. */
export function fixtureRecipients(scenario: FixtureScenario): RecipientList {
  if (scenario === 'quiet') return { recipients: [] };
  return {
    recipients: [
      {
        id: 'fx-r1',
        label: 'Mara Okonjo',
        address: OWNER,
        maxPerTx: U(1200),
        scheduleDayOfMonth: 1,
        status: 'active',
      },
      {
        id: 'fx-r2',
        label: 'Tomas Berg',
        address: AGENT,
        maxPerTx: U(900),
        scheduleDayOfMonth: null,
        status: 'active',
      },
    ],
  };
}

/** S7 policy: sentences + raw body, for the read-only default and JSON toggle views. */
export function fixturePolicyView(scenario: FixtureScenario): PolicyView {
  const sentences = FIXTURE_MANDATE.sentences;
  return {
    version: scenario === 'quiet' ? null : 3,
    sentences: scenario === 'quiet' ? [] : sentences,
    body:
      scenario === 'quiet'
        ? null
        : {
            version: 3,
            runwayBufferMicroUsd: U(120_000),
            limits: { perTxMicroUsd: U(50_000), dailyMicroUsd: U(60_000) },
          },
  };
}

/**
 * The owner-path status behind S9 (task 7.8). `frozen` and `freeze-sweep` exist so the two later
 * steps — which in reality only appear after a real freeze and a real revoke transaction — can be
 * seen and screenshotted without moving any money.
 */
export function fixtureOwnerPath(scenario: FixtureScenario): OwnerPath {
  const frozen =
    scenario === 'frozen' || scenario === 'freeze-revoke' || scenario === 'freeze-sweep';
  const revoked = scenario === 'freeze-sweep';
  return {
    frozen,
    frozenAt: frozen ? ago(3) : null,
    frozenReason: frozen ? 'owner freeze' : null,
    revoke: revoked
      ? { state: 'revoked', at: ago(2) }
      : {
          state: 'todo',
          account: TREASURY,
          to: '0xf85210B21cC50302F477BA56686d2019dC9b67Ad',
          data: `0x1a5d1d40${'0'.repeat(128)}`,
          permissionId: 'fx-permission',
        },
    sweep: scenario === 'freeze-sweep' ? { state: 'submitted', txHash: TX } : { state: 'none' },
  };
}
