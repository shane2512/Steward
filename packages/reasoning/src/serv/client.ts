import OpenAI from 'openai';
import { err, hashCanonical, ok, type Result, type Secret } from '@steward/shared';

/** The five reasoning tasks (SERV_REASONING §4). */
export const SERV_TASKS = ['compile', 'propose', 'verify', 'screen', 'explain'] as const;
export type ServTask = (typeof SERV_TASKS)[number];

export type ServRequest = {
  task: ServTask;
  model: string;
  /** SERV requires a system/developer message (V-01). */
  system: string;
  user: string;
  /** Strict json_schema forcing (V-08). */
  schema: { name: string; schema: Record<string, unknown> };
  maxOutputTokens?: number;
};

export type ServUsage = { promptTokens?: number; completionTokens?: number; totalTokens?: number };

export type ServResponse = {
  text: string;
  /** SERV sends no `x-request-id`; the response body `id` is the request id (V-08). */
  requestId: string;
  model: string;
  usage?: ServUsage;
  latencyMs: number;
};

export type ServErrorCode = 'TIMEOUT' | 'NETWORK' | 'HTTP' | 'EMPTY' | 'FIXTURE_MISSING';
export type ServError = { code: ServErrorCode; message: string; status?: number };

/**
 * The only way reasoning talks to a model. No tools, no function calling, no AgentKit (I3): a
 * request is text in, text out, schema-forced.
 */
export interface ServClient {
  complete(req: ServRequest): Promise<Result<ServResponse, ServError>>;
}

/** Deterministic fixture key: same prompt + model + schema ⇒ same recorded answer. */
export function requestHash(req: ServRequest): `0x${string}` {
  return hashCanonical({
    task: req.task,
    model: req.model,
    system: req.system,
    user: req.user,
    schema: req.schema,
  });
}

export type ServLogFields = {
  task: ServTask;
  model: string;
  requestId: string | null;
  requestHash: string;
  latencyMs: number;
  usage?: ServUsage;
  attempt: number;
  outcome: 'ok' | ServErrorCode;
  status?: number;
};

export type LiveServOptions = {
  apiKey: Secret<string>;
  baseURL: string;
  timeoutMs?: number;
  /** Retries only for network/timeout/5xx; never for 4xx (SERV_REASONING §2). */
  maxRetries?: number;
  backoffMs?: number;
  /** Usage logging. Prompt bodies are never passed here — only the hash. */
  log?: (fields: ServLogFields) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class LiveServClient implements ServClient {
  readonly #client: OpenAI;
  readonly #baseURL: string;
  readonly #apiKey: Secret<string>;
  readonly #opts: Required<Omit<LiveServOptions, 'apiKey' | 'baseURL' | 'log'>> &
    Pick<LiveServOptions, 'log'>;

  constructor(o: LiveServOptions) {
    this.#baseURL = o.baseURL.replace(/\/$/, '');
    this.#apiKey = o.apiKey;
    this.#opts = {
      timeoutMs: o.timeoutMs ?? 30_000,
      maxRetries: o.maxRetries ?? 1,
      backoffMs: o.backoffMs ?? 500,
      sleep: o.sleep ?? defaultSleep,
      now: o.now ?? (() => Date.now()),
      log: o.log,
    };
    this.#client = new OpenAI({
      apiKey: o.apiKey.reveal(),
      baseURL: this.#baseURL,
      timeout: this.#opts.timeoutMs,
      maxRetries: 0, // retries are ours, so the policy is explicit and testable
    });
  }

  /**
   * D-4: `GET /v1/models` is not OpenAI-shaped (`{items:[{modelId}]}`), so `client.models.list()`
   * returns nothing. Validate a configured model name with a raw fetch instead.
   */
  async listModels(): Promise<Result<string[], ServError>> {
    try {
      const res = await fetch(`${this.#baseURL}/models`, {
        headers: { Authorization: `Bearer ${this.#apiKey.reveal()}` },
        signal: AbortSignal.timeout(this.#opts.timeoutMs),
      });
      if (!res.ok)
        return err({ code: 'HTTP', message: `models ${res.status}`, status: res.status });
      const body: unknown = await res.json();
      const items =
        body !== null && typeof body === 'object' && 'items' in body
          ? (body as { items?: unknown }).items
          : undefined;
      if (!Array.isArray(items)) return err({ code: 'EMPTY', message: 'no items[] in /models' });
      return ok(
        items
          .map((i) =>
            i !== null && typeof i === 'object' && 'modelId' in i
              ? String((i as { modelId: unknown }).modelId)
              : '',
          )
          .filter(Boolean),
      );
    } catch (e) {
      return err({ code: 'NETWORK', message: describe(e) });
    }
  }

  async complete(req: ServRequest): Promise<Result<ServResponse, ServError>> {
    const hash = requestHash(req);
    let last: ServError = { code: 'NETWORK', message: 'no attempt made' };
    for (let attempt = 0; attempt <= this.#opts.maxRetries; attempt++) {
      const started = this.#opts.now();
      const r = await this.#once(req);
      const latencyMs = this.#opts.now() - started;
      if (r.ok) {
        this.#opts.log?.({
          task: req.task,
          model: r.value.model,
          requestId: r.value.requestId,
          requestHash: hash,
          latencyMs,
          ...(r.value.usage ? { usage: r.value.usage } : {}),
          attempt,
          outcome: 'ok',
        });
        return ok({ ...r.value, latencyMs });
      }
      last = r.error;
      this.#opts.log?.({
        task: req.task,
        model: req.model,
        requestId: null,
        requestHash: hash,
        latencyMs,
        attempt,
        outcome: r.error.code,
        ...(r.error.status !== undefined ? { status: r.error.status } : {}),
      });
      if (!retryable(r.error) || attempt === this.#opts.maxRetries) break;
      await this.#opts.sleep(this.#opts.backoffMs * 2 ** attempt);
    }
    return err(last);
  }

  async #once(req: ServRequest): Promise<Result<Omit<ServResponse, 'latencyMs'>, ServError>> {
    try {
      const completion = await this.#client.chat.completions.create({
        model: req.model,
        // Lowest supported determinism knob; SERV honours OpenAI's parameter set.
        temperature: 0,
        ...(req.maxOutputTokens ? { max_completion_tokens: req.maxOutputTokens } : {}),
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: req.schema.name, strict: true, schema: req.schema.schema },
        },
      });
      const text = completion.choices[0]?.message?.content ?? '';
      if (!text.trim()) return err({ code: 'EMPTY', message: 'empty completion' });
      return ok({
        text,
        requestId: completion.id,
        model: completion.model,
        ...(completion.usage
          ? {
              usage: {
                promptTokens: completion.usage.prompt_tokens,
                completionTokens: completion.usage.completion_tokens,
                totalTokens: completion.usage.total_tokens,
              },
            }
          : {}),
      });
    } catch (e) {
      return err(classify(e));
    }
  }
}

const retryable = (e: ServError) =>
  e.code === 'TIMEOUT' ||
  e.code === 'NETWORK' ||
  (e.code === 'HTTP' && e.status !== undefined && e.status >= 500);

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function classify(e: unknown): ServError {
  const status =
    e !== null && typeof e === 'object' && 'status' in e && typeof e.status === 'number'
      ? e.status
      : undefined;
  const name = e instanceof Error ? e.name : '';
  if (name === 'APIConnectionTimeoutError' || name === 'TimeoutError' || name === 'AbortError') {
    return { code: 'TIMEOUT', message: describe(e) };
  }
  if (status !== undefined) return { code: 'HTTP', message: describe(e), status };
  return { code: 'NETWORK', message: describe(e) };
}

/** A recorded live call (fixtures/*.json). */
export type ServFixture = {
  requestHash: string;
  task: ServTask;
  model: string;
  response: { text: string; requestId: string; model: string; usage?: ServUsage };
  recordedAt?: string;
};

/**
 * Deterministic replay. Keyed by request hash; `scripted` entries let a test force a specific model
 * output for a task (the "compromised proposer" variants in the adversarial suite).
 */
export class FixtureServClient implements ServClient {
  readonly #byHash = new Map<string, ServFixture>();
  readonly #scripted = new Map<ServTask, string>();
  readonly calls: ServRequest[] = [];

  constructor(
    fixtures: readonly ServFixture[] = [],
    scripted: Partial<Record<ServTask, string>> = {},
  ) {
    for (const f of fixtures) this.#byHash.set(f.requestHash, f);
    for (const [task, text] of Object.entries(scripted)) {
      if (text !== undefined) this.#scripted.set(task as ServTask, text);
    }
  }

  script(task: ServTask, text: string): this {
    this.#scripted.set(task, text);
    return this;
  }

  complete(req: ServRequest): Promise<Result<ServResponse, ServError>> {
    this.calls.push(req);
    const hash = requestHash(req);
    const fixture = this.#byHash.get(hash);
    if (fixture) {
      return Promise.resolve(
        ok({
          text: fixture.response.text,
          requestId: fixture.response.requestId,
          model: fixture.response.model,
          ...(fixture.response.usage ? { usage: fixture.response.usage } : {}),
          latencyMs: 0,
        }),
      );
    }
    const scripted = this.#scripted.get(req.task);
    if (scripted !== undefined) {
      return Promise.resolve(
        ok({ text: scripted, requestId: `fixture-${req.task}`, model: req.model, latencyMs: 0 }),
      );
    }
    // Fail closed: an un-recorded call must never silently become a live one.
    return Promise.resolve(
      err<ServError>({ code: 'FIXTURE_MISSING', message: `no fixture for ${req.task} ${hash}` }),
    );
  }
}
