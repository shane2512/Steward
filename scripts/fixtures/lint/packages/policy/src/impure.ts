// DELIBERATE purity violations (I2). `pnpm check:lint:fixture` must see eslint flag every line
// below; it is git-tracked but excluded from `pnpm lint` (scripts/fixtures/** is ignored).
export function impure(): unknown {
  const t = Date.now();
  const d = new Date();
  const r = Math.random();
  const e = process.env.SECRET;
  const g = globalThis;
  const f = fetch;
  setTimeout(() => undefined, 1);
  return { t, d, r, e, g, f };
}

export async function alsoImpure(): Promise<unknown> {
  return await fetch('https://example.com');
}
