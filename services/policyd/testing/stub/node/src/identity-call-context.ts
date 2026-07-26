export interface IdentityCallContext {
  readonly invocationToken: string;
  readonly traceparent?: string;
  readonly cancellation: AbortSignal;
}
