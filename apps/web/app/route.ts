import { readFile } from 'node:fs/promises';
import path from 'node:path';

// S1 landing. Serves generated/landing.html — a hand-authored copy of docs/design/refs/code.html
// (a Tailwind/lucide marketing page built for this project) with its structure, Tailwind classes,
// scroll-reveal animations and layout untouched; only copy, button labels and the brand name were
// swapped for Steward's real product. The "testimonial" cards in the source reference real people
// who don't exist, so that section was replaced with real, citable evidence (the adversarial
// corpus result, the on-chain revoke proof, the security review) instead of fabricated quotes.
// Served as a raw file, bypassing the root layout/React entirely, because the source is already a
// complete standalone <html> document and re-authoring it in React kept losing animation fidelity.
const FILE = path.join(process.cwd(), 'generated', 'landing.html');

let cached: string | null = null;

export async function GET() {
  if (cached === null) {
    cached = await readFile(FILE, 'utf-8');
  }
  return new Response(cached, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
