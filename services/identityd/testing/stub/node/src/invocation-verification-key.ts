export interface InvocationVerificationKey {
  readonly keyId: string;
  readonly algorithm: string;
  readonly modulusBase64url: string;
  readonly exponentBase64url: string;
}

export interface InvocationVerificationKeyResponse {
  readonly keys: readonly InvocationVerificationKey[];
  readonly expiresAt: string;
}
