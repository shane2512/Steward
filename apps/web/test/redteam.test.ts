// 8.7 red-team RT-1 — "can a malformed or injected notification body ever be interpreted as
// executable content anywhere it is rendered?"
//
// A notification body is the one string in Steward that starts as untrusted data (a vault name, a
// DENY reason quoting a proposal, a recipient label) and ends up on a screen the owner trusts. It
// has exactly two render surfaces:
//
//   1. the in-app notification centre — React, which escapes every JSX child;
//   2. Telegram — asserted separately in packages/db/test/notifications.test.ts to carry no
//      `parse_mode`, so the Bot API renders it as literal text.
//
// React's escaping is only a guarantee while nobody reaches for an HTML sink. This is a static
// scan of the whole web app that fails the build the moment one appears: it is cheaper and far
// more complete than rendering one component and hoping the next author does the same thing.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = join(__dirname, '..');
const SCANNED = ['app', 'components', 'lib'];

/** Every .ts/.tsx file the web app actually ships, excluding this test tree. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
  };
  for (const dir of SCANNED) walk(join(WEB, dir));
  return out;
}

describe('RT-1 — no HTML injection sink exists in the web app', () => {
  const files = sourceFiles();

  it('scans a real, non-empty file set (so a broken path cannot pass this vacuously)', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.includes('NotificationBell'))).toBe(true);
  });

  it.each([
    ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
    ['innerHTML / outerHTML', /\.(inner|outer)HTML\s*=/],
    ['insertAdjacentHTML', /insertAdjacentHTML/],
    ['document.write', /document\s*\.\s*write/],
    ['eval / new Function', /\beval\s*\(|new\s+Function\s*\(/],
  ])('has no %s', (_label, pattern) => {
    const hits = files.filter((f) => pattern.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => f.slice(WEB.length + 1))).toEqual([]);
  });

  it('renders the notification title and body as plain JSX children', () => {
    // The escaping guarantee is React's, and it only applies to children — not to an attribute
    // like href. Pin that the bell interpolates both strings as children and nothing else.
    const src = readFileSync(join(WEB, 'components/shell/NotificationBell.tsx'), 'utf8');
    expect(src).toMatch(/\{\s*n\.title\s*\}/);
    expect(src).toMatch(/\{\s*n\.body\s*\}/);
    // A body must never be able to become a link target, which React does NOT escape.
    expect(src).not.toMatch(/href=\{[^}]*\bn\.(body|title)\b/);
  });
});
