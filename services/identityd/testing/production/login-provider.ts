export type LoginProviderState = "active" | "disabled" | "deleted";

export interface LoginProvider {
  readonly tenantId: string;
  readonly providerId: string;
  readonly displayName: string;
  readonly configurationId: string;
  readonly configurationVersionId: string;
  readonly secretId: string;
  readonly secretVersionId: string;
  readonly state: LoginProviderState;
  readonly revision: number;
}
