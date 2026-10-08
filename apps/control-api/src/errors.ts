/** Control-plane error codes. Messages are code-defined and never carry tokens, subjects or other private values. */
export const CONTROL_ERROR_CODES = [
  'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'GROUP_ARCHIVED', 'INVALID_STATE', 'INVITE_INVALID', 'IDENTITY_CONFLICT', 'VALIDATION', 'LEASE_CONFLICT',
] as const;
export type ControlErrorCode = (typeof CONTROL_ERROR_CODES)[number];

export class ControlPlaneError extends Error {
  readonly code: ControlErrorCode;
  constructor(code: ControlErrorCode, message: string = code) {
    super(message);
    this.name = 'ControlPlaneError';
    this.code = code;
  }
}
export const deny = (code: ControlErrorCode, message?: string): never => { throw new ControlPlaneError(code, message); };
