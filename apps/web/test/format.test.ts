import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatMoney,
  formatToken,
  formatWhen,
  groupAddress,
  pctOf,
  shortAddress,
  splitBalance,
  toBig,
} from '../lib/format';

describe('money formatting is bigint-safe (I12)', () => {
  it('groups thousands and trims trailing zeros, exactly', () => {
    expect(formatToken(10_000_000_000n)).toBe('10,000');
    expect(formatToken(1_234_500_000n)).toBe('1,234.5');
    expect(formatToken(1n)).toBe('0.000001');
    expect(formatToken(0n)).toBe('0');
  });

  it('does not lose precision above 2^53 (a JS number would)', () => {
    const huge = 9_007_199_254_740_993_000_000n; // > Number.MAX_SAFE_INTEGER base units
    expect(formatToken(huge)).toBe('9,007,199,254,740,993');
    expect(formatMoney(huge)).toBe('9,007,199,254,740,993 USDC ($9,007,199,254,740,993)');
  });

  it('the money rule: token first, USD in parentheses', () =>
    expect(formatMoney(10_000_000_000n)).toBe('10,000 USDC ($10,000)'));

  it('balance hero splits whole and minor units so the minor can be dimmed', () => {
    expect(splitBalance(12_480_000_000n)).toEqual({ whole: '12,480', minor: '.00' });
    expect(splitBalance(38_200_000n)).toEqual({ whole: '38', minor: '.20' });
    expect(splitBalance(0n)).toEqual({ whole: '0', minor: '.00' });
  });

  it('balance truncates below a cent instead of rounding money up', () => {
    expect(splitBalance(1_999_999n)).toEqual({ whole: '1', minor: '.99' });
    expect(splitBalance(999n)).toEqual({ whole: '0', minor: '.00' });
  });

  it('negative values keep their sign', () => expect(splitBalance(-5_500_000n).whole).toBe('-5'));

  it('toBig accepts only digit strings; anything else is zero on screen, never NaN', () => {
    expect(toBig('123')).toBe(123n);
    for (const bad of ['1.5', '-1', 'abc', '', null, undefined, '1e6']) expect(toBig(bad)).toBe(0n);
  });

  it('pctOf is integer bigint maths clamped to 0..100', () => {
    expect(pctOf(25n, 100n)).toBe(25);
    expect(pctOf(500n, 100n)).toBe(100);
    expect(pctOf(1n, 0n)).toBe(0);
    expect(pctOf(2_400_000_000n, 10_000_000_000n)).toBe(24);
  });
});

describe('addresses and time', () => {
  const ADDR = '0x1d4f2a9960b7c8028f3e5a71b9c04d6e7a12b3c4';
  it('groups an address in 4-character chunks and never drops characters', () => {
    const g = groupAddress(ADDR);
    expect(g.startsWith('0x 1d4f 2a99')).toBe(true);
    expect(g.replace(/[\s]/g, '')).toBe(ADDR);
  });
  it('shortAddress keeps both ends', () => expect(shortAddress(ADDR)).toBe('0x1d4f...b3c4'));

  const NOW = new Date(2026, 8, 22, 15, 0, 0);
  it('formatAgo', () => {
    expect(formatAgo(new Date(NOW.getTime() - 10_000).toISOString(), NOW)).toBe('just now');
    expect(formatAgo(new Date(NOW.getTime() - 6 * 60_000).toISOString(), NOW)).toBe('6 min ago');
    expect(formatAgo(new Date(NOW.getTime() - 2 * 3600_000).toISOString(), NOW)).toBe('2h ago');
    expect(formatAgo(new Date(NOW.getTime() - 3 * 86_400_000).toISOString(), NOW)).toBe('3d ago');
  });
  it('formatWhen shows a clock time for today', () => {
    expect(formatWhen(new Date(2026, 8, 22, 9, 4).toISOString(), NOW)).toBe('09:04');
    expect(formatWhen('not a date', NOW)).toBe('');
  });
});
