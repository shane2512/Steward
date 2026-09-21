'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { captureFixtureFromUrl } from '@/lib/api';
import { makeWagmiConfig } from '@/lib/wagmi';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    captureFixtureFromUrl(); // synchronously, before any child query fires
    return new QueryClient({
      defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 0 } },
    });
  });
  const [wagmi] = useState(makeWagmiConfig);
  return (
    <WagmiProvider config={wagmi}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
