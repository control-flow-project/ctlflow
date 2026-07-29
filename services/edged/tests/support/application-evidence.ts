export interface ApplicationEvidence {
  readonly method: string;
  readonly target: string;
  readonly headers: Readonly<Record<string, string | readonly string[]>>;
  readonly bodyBytes: number;
  readonly bodySha256: string;
  readonly abortedRequests: number;
}

export function parseApplicationEvidence(
  body: Buffer
): ApplicationEvidence {
  const value = JSON.parse(body.toString("utf8")) as unknown;
  if (value === null || typeof value !== "object") {
    throw new Error("Application evidence is not an object");
  }
  return value as ApplicationEvidence;
}
