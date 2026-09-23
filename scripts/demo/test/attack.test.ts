// The chain-dependent half of scripts/demo/attack.ts needs STEWARD_LIVE=1 and a real wallet (it is
// exercised live, not in this suite — see the script's own header). What IS testable here, with the
// real production code and no mocking, is the property the whole beat depends on: the exact memo the
// script sends trips the deterministic injection heuristics (packages/reasoning) on their own, with
// no SERV call required — R16 then denies any value-moving proposal regardless of what the model
// does (packages/policy/test/rules.test.ts already covers R16 itself end to end).
import { describe, expect, it } from 'vitest';
import { screenItems } from '@steward/reasoning';
import { ATTACK_MEMO } from '../attack';

describe('demo attack memo (9.2)', () => {
  it('the deterministic heuristics flag it without any SERV call', () => {
    const result = screenItems([{ id: 'attack-memo', text: ATTACK_MEMO }]);
    expect(result.hit).toBe(true);
    const joined = result.signals.join(' ');
    expect(joined).toContain('address_like');
    expect(joined).toMatch(/urgency|authority|totality|new_destination/);
  });
});
