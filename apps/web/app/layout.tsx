import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Steward',
  description: 'The self-driving treasury that cannot run off with the money.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
