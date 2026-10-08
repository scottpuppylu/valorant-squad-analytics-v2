/**
 * Allowlist logger for the importer: an event name plus fields whose values are numbers, booleans, null or SAFE strings.
 * A string is kept only if it is a short label / community name / version / ISO instant / dataset fingerprint; anything
 * else (URLs, provider ids, match ids, uuid-shaped or long opaque tokens, Riot-ID handles) is replaced by "[redacted]".
 */
export type LogValue = number | boolean | null | string | LogValue[] | { [key: string]: LogValue };
export type LogSink = (line: string) => void;

const SAFE_STRING = [
  /^cdfp-v1:[0-9a-f]{64}$/u, // dataset fingerprint
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/u, // instant
  /^[a-z][a-z0-9:._-]{0,59}$/u, // labels, versions, statuses
];
const UNSAFE = [/:\/\//u, /#/u, /[0-9a-f]{8}-[0-9a-f]{4}-/iu, /[A-Za-z0-9_-]{30,}/u, /@/u];
/** Community display names: short, no separators typical of ids or handles. */
const NAME = /^[\p{L}\p{N} ._-]{1,20}$/u;

export function sanitizeString(value: string): string {
  if (SAFE_STRING.some((rx) => rx.test(value))) return value;
  if (UNSAFE.some((rx) => rx.test(value))) return '[redacted]';
  return NAME.test(value) ? value : '[redacted]';
}

/** Field names are code-defined identifiers (camelCase, no long digit runs, no separators); anything else is redacted. */
const FIELD = /^[A-Za-z][A-Za-z0-9]{0,47}$/u;
export function sanitizeKey(key: string): string {
  return FIELD.test(key) && !/[0-9]{4,}/u.test(key) ? key : sanitizeString(key);
}

export function sanitize(value: unknown): LogValue {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value as LogValue;
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [sanitizeKey(k), sanitize(v)]));
  return '[redacted]';
}

export function createSafeLogger(sink: LogSink = (line) => process.stdout.write(`${line}\n`)) {
  return (event: string, fields: Record<string, unknown> = {}) => sink(JSON.stringify({ event: sanitizeString(event), ...(sanitize(fields) as Record<string, LogValue>) }));
}
export type SafeLogger = ReturnType<typeof createSafeLogger>;
