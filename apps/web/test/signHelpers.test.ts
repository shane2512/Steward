// Pure helpers behind the 7.6 signing flows: the error copy table, the look-alike heuristic, the
// amount parser and the policy sentence diff.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import { diffSentences } from '../lib/policyDraft';
import { looksLikeExisting, parseUsdc, sixAndSix } from '../lib/recipientForm';
import { isRejection, signErrorCopy } from '../lib/signCopy';
import { PHASE_STATUS } from '../lib/useSignFlow';

describe('signErrorCopy', () => {
  it('maps a known code to its own sentence, never a generic one', () => {
    const e = signErrorCopy(new ApiError(410, 'expired', 'this approval has expired'));
    expect(e.title).toBe('This approval expired');
    expect(e.body).toMatch(/Nothing was done/);
    expect(e.retryable).toBe(false);
  });

  it('keeps the SERVER message for a code it does not know, rather than inventing a reason', () => {
    const e = signErrorCopy(new ApiError(409, 'some_new_code', 'the vault is flagged.'));
    expect(e.body).toBe('the vault is flagged. Nothing was recorded.');
  });

  it('treats a wallet rejection as a choice, not a fault', () => {
    const rejected = Object.assign(new Error('User rejected the request.'), { code: 4001 });
    expect(isRejection(rejected)).toBe(true);
    expect(signErrorCopy(rejected).title).toBe('Signature not given');
    expect(signErrorCopy(rejected).retryable).toBe(true);
  });

  it('an ApiError is never classified as a wallet rejection', () => {
    expect(isRejection(new ApiError(401, 'bad_signature', 'user rejected'))).toBe(false);
  });

  it('every phase has something to announce except idle and error', () => {
    expect(PHASE_STATUS['awaiting-signature']).toMatch(/wallet/i);
    expect(PHASE_STATUS.done).toMatch(/Steward accepted/);
    expect(PHASE_STATUS.idle).toBe('');
  });
});

describe('looksLikeExisting (WARNING ONLY — R05 still matches exactly)', () => {
  const existing = [{ label: 'Mara', address: '0x1d4f2a99Ac91C6A1C1C0a4D1E4a3f7bd7b53c802' }];

  it('flags a shared prefix', () => {
    expect(looksLikeExisting('0x1d4f00000000000000000000000000000000abcd', existing)?.label).toBe(
      'Mara',
    );
  });

  it('flags a shared suffix', () => {
    expect(looksLikeExisting('0xabcd0000000000000000000000000000000c802', existing)).toBeNull();
    expect(looksLikeExisting('0xabcd000000000000000000000000000000c802ab', existing)).toBeNull();
    expect(looksLikeExisting('0xabcd00000000000000000000000000000003c802', existing)?.label).toBe(
      'Mara',
    );
  });

  it('ignores an identical address (that is a duplicate, not a look-alike)', () => {
    expect(looksLikeExisting(existing[0]!.address, existing)).toBeNull();
  });

  it('ignores anything unrelated or malformed', () => {
    expect(looksLikeExisting('0x9999999999999999999999999999999999999999', existing)).toBeNull();
    expect(looksLikeExisting('not-an-address', existing)).toBeNull();
  });

  it('is case-insensitive, so a checksum difference cannot hide a look-alike', () => {
    expect(looksLikeExisting('0x1D4F00000000000000000000000000000000ABCD', existing)?.label).toBe(
      'Mara',
    );
  });
});

describe('parseUsdc / sixAndSix', () => {
  it('parses to bigint base units and rejects nonsense (I12)', () => {
    expect(parseUsdc('1,200.50')).toEqual({ ok: true, value: 1_200_500_000n });
    expect(parseUsdc('4000').ok).toBe(true);
    expect(parseUsdc('-1').ok).toBe(false);
    expect(parseUsdc('1.1234567').ok).toBe(false);
    expect(parseUsdc('').ok).toBe(false);
    expect(parseUsdc('1e6').ok).toBe(false);
  });

  it('shows first six and last six characters', () => {
    expect(sixAndSix('0x1d4f2a99Ac91C6A1C1C0a4D1E4a3f7bd7b53c802')).toBe('0x1d4f…53c802');
  });
});

describe('diffSentences', () => {
  it('reports what a new policy version adds and removes', () => {
    expect(diffSentences(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
  });

  it('an unchanged policy diffs to nothing', () => {
    expect(diffSentences(['a', 'b'], ['a', 'b'])).toEqual({ added: [], removed: [] });
  });

  it('a first activation is all additions', () => {
    expect(diffSentences([], ['a'])).toEqual({ added: ['a'], removed: [] });
  });
});
