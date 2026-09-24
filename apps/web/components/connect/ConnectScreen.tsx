'use client';
import { useConnectFlow } from '@/lib/useConnectFlow';
import { ConnectView } from './ConnectView';

export function ConnectScreen() {
  const { state, connectors, connect, retry } = useConnectFlow();
  return (
    <ConnectView
      state={state}
      connectors={connectors}
      onConnect={(id) => void connect(id)}
      onRetry={retry}
    />
  );
}
