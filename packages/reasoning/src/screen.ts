import type { UntrustedItem } from '@steward/context';
import { callJson, type CallMeta } from './call';
import { screenItems } from './heuristics';
import { buildScreenPrompt } from './prompts';
import { SERV_SCHEMAS, zServScreen } from './schemas';
import type { ServClient } from './serv/client';

export type ScreenResult = {
  injectionSuspected: boolean;
  signals: string[];
  /** Absent when no SERV call was made (empty input, or the classifier failed). */
  meta?: CallMeta;
};

export type ScreenInput = {
  client: ServClient;
  model: string;
  items: readonly UntrustedItem[];
};

/**
 * Task 4.5. Deterministic heuristics decide first and a hit alone is enough; the SERV classifier can
 * only ADD to the signal list, never clear it (SECURITY §3 L5: "Never instead"). A classifier that
 * errors leaves the heuristic verdict untouched and is recorded as a signal.
 */
export async function screenUntrusted(input: ScreenInput): Promise<ScreenResult> {
  if (input.items.length === 0) return { injectionSuspected: false, signals: [] };

  const heur = screenItems(input.items);
  const signals = heur.signals.map((s) => `heuristic:${s}`);

  const res = await callJson({
    client: input.client,
    task: 'screen',
    model: input.model,
    prompt: buildScreenPrompt(input.items),
    schema: SERV_SCHEMAS.screen,
    parser: zServScreen,
  });

  if (!res.ok) {
    return {
      injectionSuspected: heur.hit,
      signals: [...signals, `classifier:unavailable:${res.error.error.code}`],
      meta: res.error.meta,
    };
  }
  const { suspected, reasons } = res.value.value;
  if (suspected) {
    signals.push('classifier:suspected');
    for (const r of reasons.slice(0, 5)) signals.push(`classifier:${r.slice(0, 120)}`);
  }
  return {
    injectionSuspected: heur.hit || suspected,
    signals,
    meta: res.value.meta,
  };
}
