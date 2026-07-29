import {
  createSign
} from "node:crypto";

export function createSignedTokenVariant(
  token: string,
  privateKey: string,
  change: (payload: Record<string, unknown>) => void
): string {
  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new Error("Kubernetes returned a malformed workload token");
  }

  const payload = JSON.parse(
    Buffer.from(segments[1]!, "base64url").toString("utf8")
  ) as Record<string, unknown>;
  change(payload);
  const encodedPayload = Buffer.from(
    JSON.stringify(payload),
    "utf8"
  ).toString("base64url");
  const signingInput = `${segments[0]!}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}
