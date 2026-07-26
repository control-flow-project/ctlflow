import {
  createPublicKey,
  verify
} from "node:crypto";
import {
  VerificationKeyAlgorithm,
  type InvocationVerificationKey
} from "../../generated/v1/identityd.js";

export interface VerifiedInvocationClaims {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly act?: {
    readonly sub: string;
  };
  readonly tenant_id: string;
  readonly workspace_id?: string;
  readonly session_id?: string;
  readonly run_id?: string;
  readonly iat: number;
  readonly nbf: number;
  readonly exp: number;
  readonly jti: string;
}

export function verifyInvocationJwt(
  token: string,
  key: InvocationVerificationKey
): VerifiedInvocationClaims {
  if (
    key.algorithm
    !== VerificationKeyAlgorithm.VERIFICATION_KEY_ALGORITHM_RS256
  ) {
    throw new Error("Invocation verification key is not RS256");
  }

  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new Error("Invocation JWT is malformed");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const header = parseJson<{
    readonly alg: string;
    readonly kid: string;
    readonly typ: string;
  }>(encodedHeader!);
  if (
    header.alg !== "RS256"
    || header.kid !== key.keyId
    || header.typ !== "JWT"
  ) {
    throw new Error("Invocation JWT header is invalid");
  }

  const publicKey = createPublicKey({
    key: {
      kty: "RSA",
      n: key.modulusBase64url,
      e: key.exponentBase64url
    },
    format: "jwk"
  });
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  if (!verify(
    "RSA-SHA256",
    Buffer.from(signingInput, "ascii"),
    publicKey,
    Buffer.from(encodedSignature!, "base64url")
  )) {
    throw new Error("Invocation JWT signature is invalid");
  }

  return parseJson<VerifiedInvocationClaims>(encodedPayload!);
}

function parseJson<T>(encoded: string): T {
  const parsed: unknown = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"));
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("Invocation JWT JSON is invalid");
  }

  return parsed as T;
}
