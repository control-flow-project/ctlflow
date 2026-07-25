export interface StatusDocument {
  readonly apiVersion: "v1";
  readonly kind: "Status";
  readonly status: "Failure";
  readonly reason: string;
  readonly code: number;
  readonly message: string;
}
