// The S2 connect state machine (UX_FLOWS S2): connecting, wrong network with auto-switch to Base
// Sepolia, signature rejected with retry, unsupported wallet. Pure and synchronous so every state can
// be tested without a wallet. It only chooses which screen to show; the server verifies the signature.
export const TARGET_CHAIN_ID = 84532;

export type ConnectState =
  | { step: 'idle' }
  | { step: 'connecting' }
  | { step: 'wrong_network'; chainId: number }
  | { step: 'switching' }
  | { step: 'signing' }
  | { step: 'verifying' }
  | { step: 'signed_in' }
  | { step: 'rejected'; at: 'connect' | 'switch' | 'sign' }
  | { step: 'unsupported' }
  | { step: 'error'; message: string };

export type FailReason = 'rejected' | 'unsupported' | 'other';

export type ConnectEvent =
  | { type: 'connect' }
  | { type: 'connected'; chainId: number }
  | { type: 'switch' }
  | { type: 'switched' }
  | { type: 'sign' }
  | { type: 'verify' }
  | { type: 'done' }
  | {
      type: 'fail';
      reason: FailReason;
      at: 'connect' | 'switch' | 'sign' | 'verify';
      message?: string;
    }
  | { type: 'reset' };

export const initialConnectState: ConnectState = { step: 'idle' };

/** Invalid transitions are ignored, never thrown: a stray event cannot wedge the screen. */
export function connectReducer(s: ConnectState, e: ConnectEvent): ConnectState {
  switch (e.type) {
    case 'reset':
      return initialConnectState;
    case 'connect':
      return s.step === 'idle' || s.step === 'rejected' || s.step === 'error'
        ? { step: 'connecting' }
        : s;
    case 'connected':
      if (s.step !== 'connecting') return s;
      return e.chainId === TARGET_CHAIN_ID
        ? { step: 'signing' }
        : { step: 'wrong_network', chainId: e.chainId };
    case 'switch':
      return s.step === 'wrong_network' || (s.step === 'rejected' && s.at === 'switch')
        ? { step: 'switching' }
        : s;
    case 'switched':
      return s.step === 'switching' ? { step: 'signing' } : s;
    case 'sign':
      return s.step === 'rejected' && s.at === 'sign' ? { step: 'signing' } : s;
    case 'verify':
      return s.step === 'signing' ? { step: 'verifying' } : s;
    case 'done':
      return s.step === 'verifying' ? { step: 'signed_in' } : s;
    case 'fail':
      if (e.reason === 'unsupported') return { step: 'unsupported' };
      if (e.reason === 'rejected')
        return { step: 'rejected', at: e.at === 'verify' ? 'sign' : e.at };
      return {
        step: 'error',
        message: e.message ?? 'Steward could not sign you in. Nothing moved. Try again.',
      };
  }
}

/** Sort a wallet/connector error into the three outcomes the screen has copy for. */
export function classifyConnectError(e: unknown): FailReason {
  const code = (e as { code?: unknown } | null)?.code;
  const name = (e as { name?: unknown } | null)?.name;
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  // EIP-1193 4001 = user rejected; viem names it UserRejectedRequestError; some SDKs only say "denied"
  if (
    code === 4001 ||
    name === 'UserRejectedRequestError' ||
    /reject|denied|declined|closed/i.test(msg)
  )
    return 'rejected';
  if (/smart ?wallet|not supported|unsupported|eoa|no provider|not installed/i.test(msg))
    return 'unsupported';
  return 'other';
}

/** What the screen says for each state. Plain words; says what happened and whether money moved. */
export function connectCopy(s: ConnectState): { title: string; body: string } | null {
  switch (s.step) {
    case 'idle':
      return null;
    case 'connecting':
      return {
        title: 'Waiting for your wallet',
        body: 'Approve the connection in the Coinbase Smart Wallet window.',
      };
    case 'wrong_network':
      return {
        title: 'Wrong network',
        body: 'Your wallet is on another network. Steward runs on Base Sepolia only, so it is switching your wallet now.',
      };
    case 'switching':
      return {
        title: 'Switching to Base Sepolia',
        body: 'Approve the network change in your wallet.',
      };
    case 'signing':
      return {
        title: 'Sign in to Steward',
        body: 'Your wallet will ask you to sign a message. It proves the wallet is yours and costs nothing.',
      };
    case 'verifying':
      return { title: 'Checking your signature', body: 'One moment.' };
    case 'signed_in':
      return { title: 'Signed in', body: 'Taking you to Steward.' };
    case 'rejected':
      return {
        title:
          s.at === 'sign'
            ? 'Signature not given'
            : s.at === 'switch'
              ? 'Network not switched'
              : 'Connection cancelled',
        body: 'You closed the request. Nothing was signed and nothing moved. You can try again when you are ready.',
      };
    case 'unsupported':
      return {
        title: 'No wallet found',
        body: 'Steward could not find a Coinbase Smart Wallet or a browser wallet extension like MetaMask. Install one, or create a Smart Wallet with a passkey, then try again. Nothing moved.',
      };
    case 'error':
      return { title: 'Could not sign you in', body: s.message };
  }
}
