import { pino, type DestinationStream, type LoggerOptions } from 'pino';

// SECURITY §6 redaction paths (+ nested headers). I9: secrets are never logged.
export const REDACT_PATHS = [
  '*.apiKey',
  '*.secret',
  '*.signature',
  '*.privateKey',
  'apiKey',
  'secret',
  'signature',
  'privateKey',
  'authorization',
  'cookie',
  '*.authorization',
  '*.cookie',
  '*.headers.authorization',
  '*.headers.cookie',
];

export function createLogger(name: string, stream?: DestinationStream, opts: LoggerOptions = {}) {
  const options: LoggerOptions = {
    name,
    level: process.env['LOG_LEVEL'] ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    ...opts,
  };
  return stream ? pino(options, stream) : pino(options);
}
