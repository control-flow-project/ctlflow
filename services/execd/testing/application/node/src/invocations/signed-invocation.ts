export interface SignedInvocation {
  readonly keyId: string;
  readonly signingInput: string;
  readonly signature: Buffer;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface InvocationValidationSettings {
  readonly issuer: string;
  readonly audience: string;
  readonly maximumLifetimeSeconds: number;
}

export interface InvocationTarget {
  readonly tenantId: string;
  readonly workspaceId?: string;
}
