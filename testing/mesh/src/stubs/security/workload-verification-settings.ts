export interface WorkloadVerificationSettings {
  readonly issuer: string;
  readonly audience: string;
  readonly maximumLifetimeSeconds: number;
  readonly keySetPath: string;
}
