import type { ReactNode } from 'react';
import { Figtree, Geist_Mono } from 'next/font/google';
import './globals.css';

// docs/DESIGN.md §3 — Figtree (OFL, variable) for everything a human wrote:
// single-storey g, tall x-height, geometric-humanist grotesk. Geist Mono (OFL)
// for machine data only (addresses, hashes, tx ids, eyebrow micro-labels).
const figtree = Figtree({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-figtree',
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
    <html lang="en" className={`${figtree.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh bg-ground font-sans text-body text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
