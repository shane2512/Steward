import type { ReactNode } from 'react';
import { Geist_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { Providers } from '@/components/Providers';
import './globals.css';

// Matches generated/landing.html's body font exactly (OFL, variable). Geist
// Mono (OFL) for machine data only (addresses, hashes, tx ids, eyebrow labels).
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jakarta',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-mono',
});

export const metadata = {
  title: 'Steward',
  description: 'The self-driving treasury that cannot run off with the money.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${plusJakartaSans.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh bg-ground font-sans text-body text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-accent focus:px-4 focus:py-3 focus:text-on-accent"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
