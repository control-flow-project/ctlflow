export interface InvocationValidationSettings {
  readonly issuer: string;
  readonly audience: string;
  readonly maximumLifetimeSeconds: number;
}
