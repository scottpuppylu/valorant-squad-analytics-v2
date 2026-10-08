/**
 * Defence-in-depth guards that run IN ADDITION to the allowlist (never instead of it):
 *  - private key names, matched case- and separator-insensitively, anywhere in a document tree;
 *  - known secret / connection-string value patterns.
 */
const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/gu, '');

/** Exact private key names (normalized). */
const PRIVATE_KEYS = new Set([
  'puuid', 'matchidraw', 'rawmatchid', 'providermatchid', 'providerrecordref', 'provideraccountref', 'accountref',
  'participantid', 'rawparticipantid', 'participantkey', 'accountid', 'memberid',
  'accesstoken', 'refreshtoken', 'idtoken', 'apikey', 'providersecret', 'clientsecret', 'secret', 'password',
  'databaseurl', 'connectionstring', 'dsn',
  'locationx', 'locationy', 'viewradians', 'spatial', 'position', 'coordinates', 'x', 'y', 'location', 'playersnapshots', 'plantlocation',
  'defuselocation', 'seasonref',
]);
/** Substrings that make any key private (normalized). */
const PRIVATE_KEY_FRAGMENTS = ['puuid', 'token', 'secret', 'password', 'apikey', 'hmac', 'databaseurl'];

export function isPrivateKey(key: string): boolean {
  const k = normalizeKey(key);
  return PRIVATE_KEYS.has(k) || PRIVATE_KEY_FRAGMENTS.some((fragment) => k.includes(fragment));
}

export const SECRET_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'postgres-connection-string', pattern: /postgres(?:ql)?:\/\/[^\s"']+/iu },
  { name: 'henrik-api-key', pattern: /\bHDEV-[0-9a-f]{8}-/iu },
  { name: 'riot-api-key', pattern: /\bRGAPI-[0-9a-f]{8}-/iu },
  { name: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/u },
  { name: 'private-key-block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
  { name: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/u },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/u },
];

export function findSecretPatterns(text: string): string[] {
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}
