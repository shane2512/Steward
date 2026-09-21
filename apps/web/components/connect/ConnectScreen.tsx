'use client';
import { useConnectFlow } from '@/lib/useConnectFlow';
import { ConnectView } from './ConnectView';

export function ConnectScreen() {
  const { state, connect, retry } = useConnectFlow();
  return <ConnectView state={state} onConnect={() => void connect()} onRetry={retry} />;
}
