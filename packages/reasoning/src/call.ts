import { err, ok, type Result } from '@steward/shared';
import type { z } from 'zod';
import type { BuiltPrompt } from './prompts';
import type { ServClient, ServError, ServTask, ServUsage } from './serv/client';

export type ReasoningErrorCode = 'SERV_ERROR' | 'INVALID_JSON' | 'SCHEMA';
export type ReasoningError = {
  code: ReasoningErrorCode;
  message: string;
  serv?: ServError;
};

export type CallMeta = {
  requestIds: string[];
  model: string;
  promptVersion: number;
  repaired: boolean;
  usage?: ServUsage;
  /** Raw model text, for the audit trail and for the "did it emit an address?" scan. */
  raw: string[];
};

/** Models sometimes wrap JSON in fences even under schema forcing. */
export function extractJson(text: string): Result<unknown, string> {
  const unfenced = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const start = unfenced.search(/[{[]/);
  if (start === -1) return err('no JSON object in output');
  const end = Math.max(unfenced.lastIndexOf('}'), unfenced.lastIndexOf(']'));
  if (end <= start) return err('no JSON object in output');
  try {
    return ok(JSON.parse(unfenced.slice(start, end + 1)));
  } catch (e) {
    return err(e instanceof Error ? e.message : 'JSON.parse failed');
  }
}

export type CallJsonInput<T> = {
  client: ServClient;
  task: ServTask;
  model: string;
  prompt: BuiltPrompt;
  schema: { name: string; schema: Record<string, unknown> };
  parser: z.ZodType<T>;
  maxOutputTokens?: number;
};

/**
 * One schema-forced call, with exactly ONE repair retry (SERV_REASONING §2). After that the caller
 * fails closed — every task in this package turns a failure into NOOP / UNSURE / DENY, never into
 * an optimistic guess (I5).
 */
export async function callJson<T>(
  input: CallJsonInput<T>,
): Promise<Result<{ value: T; meta: CallMeta }, { error: ReasoningError; meta: CallMeta }>> {
  const meta: CallMeta = {
    requestIds: [],
    model: input.model,
    promptVersion: input.prompt.promptVersion,
    repaired: false,
    raw: [],
  };
  let user = input.prompt.user;
  let lastError: ReasoningError = { code: 'SERV_ERROR', message: 'no attempt made' };

  for (let attempt = 0; attempt < 2; attempt++) {
    meta.repaired = attempt > 0;
    const res = await input.client.complete({
      task: input.task,
      model: input.model,
      system: input.prompt.system,
      user,
      schema: input.schema,
      ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
    });
    if (!res.ok) {
      lastError = { code: 'SERV_ERROR', message: res.error.message, serv: res.error };
      break; // the client already applied its own retry policy; a repair cannot fix a transport error
    }
    meta.requestIds.push(res.value.requestId);
    meta.raw.push(res.value.text);
    if (res.value.usage) meta.usage = res.value.usage;

    const json = extractJson(res.value.text);
    if (!json.ok) {
      lastError = { code: 'INVALID_JSON', message: json.error };
    } else {
      const parsed = input.parser.safeParse(json.value);
      if (parsed.success) return ok({ value: parsed.data, meta });
      lastError = {
        code: 'SCHEMA',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      };
    }
    if (attempt === 1) break;
    user = [
      input.prompt.user,
      '',
      'Your previous answer was rejected by the schema validator:',
      lastError.message,
      'Return ONLY the corrected JSON object. Do not explain.',
    ].join('\n');
  }
  return err({ error: lastError, meta });
}
