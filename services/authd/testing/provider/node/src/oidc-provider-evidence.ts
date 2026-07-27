export interface AuthorizationEvidence {
  readonly parameters: readonly {
    readonly name: string;
    readonly value: string;
  }[];
}

export interface TokenEvidence {
  readonly authorization: string;
  readonly body: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
}

export interface UserInfoEvidence {
  readonly authorization: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
}

export interface OidcProviderEvidence {
  readonly authorizations: readonly AuthorizationEvidence[];
  readonly tokens: readonly TokenEvidence[];
  readonly userInfo: readonly UserInfoEvidence[];
}
