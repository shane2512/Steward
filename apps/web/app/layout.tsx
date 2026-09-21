import type { ReactNode } from 'react';
import { IBM_Plex_Mono, Public_Sans } from 'next/font/google';
import './globals.css';

// docs/DESIGN.md §3 — Public Sans (OFL) for everything a human wrote,
// IBM Plex Mono (OFL) for machine data only.
const publicSans = Public_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-public-sans',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-plex-mono',
});

export const metadata = {
  title: 'Steward',
  description: 'The self-driving treasury that cannot run off with the money.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${publicSans.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh bg-ground font-sans text-body text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
