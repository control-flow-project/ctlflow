export interface OriginRequestEvidence {
  readonly method: string;
  readonly target: string;
  readonly headers: Readonly<Record<string, readonly string[]>>;
  readonly bodyBase64: string;
  cancelled: boolean;
}
