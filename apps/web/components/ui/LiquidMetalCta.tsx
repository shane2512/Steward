'use client';
import { useRouter } from 'next/navigation';
import { LiquidMetalButton } from '@/components/ui/liquid-metal-button';

/** The one place LiquidMetalButton is used: the static landing page's primary CTA. */
export function LiquidMetalCta({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  return <LiquidMetalButton label={label} onClick={() => router.push(href)} />;
}
