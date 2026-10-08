import { ControlPlaneError } from './errors.ts';

/**
 * Identity-provider port (RSO-ready). The control plane never talks to a provider's GAME data; an identity provider
 * only proves that a user controls an external account and returns its subject (PRIVATE).
 */
export interface IdentityProvider {
  readonly provider: 'RIOT' | 'DISCORD';
  /** The redirect for a one-time `state` value (the state itself is returned to the user agent once, never stored raw). */
  authorizationRequest(state: string): { redirectUrl: string };
  /** Verify a callback and return the provider subject. */
  verifyCallback(input: { state: string; code: string }): Promise<{ providerSubject: string }>;
}

/**
 * Riot Sign-On placeholder. RSO needs Production-level access (docs/RSO_READINESS.md); every operation is
 * NOT_IMPLEMENTED and performs no network call.
 */
export class RiotRsoIdentityProvider implements IdentityProvider {
  readonly provider = 'RIOT' as const;
  authorizationRequest(): { redirectUrl: string } {
    throw new ControlPlaneError('INVALID_STATE', 'RIOT_RSO_NOT_IMPLEMENTED: requires Riot Production access');
  }
  async verifyCallback(): Promise<{ providerSubject: string }> {
    throw new ControlPlaneError('INVALID_STATE', 'RIOT_RSO_NOT_IMPLEMENTED: requires Riot Production access');
  }
}

/**
 * Deterministic test double: a callback code `mock:<subject>` verifies as that subject. No network, no secrets.
 * `failNext` simulates a provider-side rejection.
 */
export class MockIdentityProvider implements IdentityProvider {
  readonly provider: 'RIOT' | 'DISCORD';
  private failNext = false;
  constructor(provider: 'RIOT' | 'DISCORD' = 'RIOT') {
    this.provider = provider;
  }
  rejectNextCallback(): void { this.failNext = true; }
  authorizationRequest(state: string): { redirectUrl: string } {
    return { redirectUrl: `mock-identity://authorize?provider=${this.provider.toLowerCase()}&state=${encodeURIComponent(state)}` };
  }
  async verifyCallback(input: { state: string; code: string }): Promise<{ providerSubject: string }> {
    if (this.failNext) { this.failNext = false; throw new ControlPlaneError('IDENTITY_CONFLICT', 'identity provider rejected the callback'); }
    const m = /^mock:([A-Za-z0-9_-]{8,100})$/u.exec(input.code);
    if (!m) throw new ControlPlaneError('VALIDATION', 'invalid identity callback');
    return { providerSubject: m[1]! };
  }
}
