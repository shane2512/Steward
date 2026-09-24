'use client';
// Drives the connect state machine with wagmi + the SIWE routes. Untested with a real passkey Smart
// Wallet (none was available in this project): the wiring follows the wagmi docs and is covered by the
// reducer tests; see PROGRESS.md.
import { useRouter } from 'next/navigation';
import { useCallback, useReducer, useRef } from 'react';
import { createSiweMessage } from 'viem/siwe';
import { getAddress } from 'viem';
import { useAccount, useConnect, useSignMessage, useSwitchChain } from 'wagmi';
import { z } from 'zod';
import { apiGet, apiPost } from './api';
import {
  classifyConnectError,
  connectReducer,
  initialConnectState,
  TARGET_CHAIN_ID,
} from './connectMachine';
import { zOnboarding } from './contracts';

const zNonce = z.object({ nonce: z.string().min(8) });
const zVerified = z.object({ user: z.object({ id: z.string(), address: z.string() }) });

export function useConnectFlow() {
  const router = useRouter();
  const [state, dispatch] = useReducer(connectReducer, initialConnectState);
  const { connectors, connectAsync } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const account = useAccount();
  // Remembers which connector the owner actually picked (MetaMask vs. Coinbase Smart Wallet), so
  // `retry()` reopens the same wallet instead of always falling back to connectors[0].
  const lastConnectorId = useRef<string | undefined>(undefined);

  const signIn = useCallback(
    async (address: string) => {
      try {
        const { nonce } = await apiGet('/api/auth/nonce', zNonce);
        const message = createSiweMessage({
          address: getAddress(address),
          chainId: TARGET_CHAIN_ID,
          domain: window.location.host,
          nonce,
          uri: window.location.origin,
          version: '1',
          statement: 'Sign in to Steward. This costs nothing and does not move funds.',
        });
        const signature = await signMessageAsync({ message });
        dispatch({ type: 'verify' });
        await apiPost('/api/auth/verify', zVerified, { message, signature });
        dispatch({ type: 'done' });
        // Resume where the SERVER says onboarding stands (S3 is resumable).
        const ob = await apiGet('/api/onboarding', zOnboarding).catch(() => null);
        router.replace(ob && ob.step !== 'done' ? '/onboarding' : '/app');
      } catch (e) {
        dispatch({ type: 'fail', reason: classifyConnectError(e), at: 'sign' });
      }
    },
    [router, signMessageAsync],
  );

  const trySwitch = useCallback(
    async (address: string) => {
      dispatch({ type: 'switch' });
      try {
        await switchChainAsync({ chainId: TARGET_CHAIN_ID });
        dispatch({ type: 'switched' });
        await signIn(address);
      } catch (e) {
        dispatch({ type: 'fail', reason: classifyConnectError(e), at: 'switch' });
      }
    },
    [signIn, switchChainAsync],
  );

  const connect = useCallback(
    async (connectorId?: string) => {
      const id = connectorId ?? lastConnectorId.current;
      const connector = id ? connectors.find((c) => c.id === id) : connectors[0];
      if (!connector) {
        dispatch({ type: 'fail', reason: 'unsupported', at: 'connect' });
        return;
      }
      lastConnectorId.current = connector.id;
      dispatch({ type: 'connect' });
      try {
        const res = await connectAsync({ connector });
        const address = res.accounts[0];
        if (!address) throw new Error('no account');
        dispatch({ type: 'connected', chainId: res.chainId });
        if (res.chainId === TARGET_CHAIN_ID) await signIn(address);
        else await trySwitch(address);
      } catch (e) {
        dispatch({ type: 'fail', reason: classifyConnectError(e), at: 'connect' });
      }
    },
    [connectAsync, connectors, signIn, trySwitch],
  );

  /** Retry from whichever step was cancelled, without asking the wallet to reconnect needlessly. */
  const retry = useCallback(() => {
    const addr = account.address;
    if (state.step === 'rejected' && state.at === 'sign' && addr) {
      dispatch({ type: 'sign' });
      void signIn(addr);
    } else if (state.step === 'rejected' && state.at === 'switch' && addr) {
      void trySwitch(addr);
    } else {
      void connect();
    }
  }, [account.address, connect, signIn, state, trySwitch]);

  return { state, connectors, connect, retry };
}
