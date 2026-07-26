import {
  verify,
  type KeyObject
} from "node:crypto";
import type {
  WorkloadVerificationSettings
} from "./workload-verification-settings.js";

interface JwtHeader {
  readonly alg?: unknown;
  readonly kid?: unknown;
  readonly typ?: unknown;
}

interface JwtClaims {
  readonly iss?: unknown;
  readonly aud?: unknown;
  readonly sub?: unknown;
  readonly iat?: unknown;
  readonly nbf?: unknown;
  readonly exp?: unknown;
  readonly "kubernetes.io"?: unknown;
}

interface KubernetesClaims {
  readonly namespace?: unknown;
  readonly serviceaccount?: unknown;
  readonly pod?: unknown;
}

interface NamedClaim {
  readonly name?: unknown;
  readonly uid?: unknown;
}

const serviceAccountPrefix = "system:serviceaccount:";
const clockSkewSeconds = 5;

export function validateWorkloadToken(
  token: string,
  settings: WorkloadVerificationSettings,
  keys: ReadonlyMap<string, KeyObject>,
  now = new Date()
): string {
  if (token.length < 1 || token.length > 16_384) {
    throw new Error("Workload token is malformed");
  }

  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new Error("Workload token is malformed");
  }

  const header = decodeJson<JwtHeader>(segments[0]!);
  const claims = decodeJson<JwtClaims>(segments[1]!);
  if (header.alg !== "RS256"
      || typeof header.kid !== "string"
      || header.kid.length < 1
      || header.kid.length > 128
      || header.typ !== undefined && header.typ !== "JWT") {
    throw new Error("Workload token header is invalid");
  }

  const key = keys.get(header.kid);
  if (key === undefined
      || !verify(
        "RSA-SHA256",
        Buffer.from(`${segments[0]!}.${segments[1]!}`, "ascii"),
        key,
        Buffer.from(segments[2]!, "base64url"))) {
    throw new Error("Workload token signature is invalid");
  }

  if (claims.iss !== settings.issuer
      || !hasAudience(claims.aud, settings.audience)
      || typeof claims.sub !== "string"
      || claims.sub.length < 1
      || claims.sub.length > 256) {
    throw new Error("Workload token authority is invalid");
  }

  const issuedAt = readUnixTime(claims.iat);
  const notBefore = readUnixTime(claims.nbf);
  const expiresAt = readUnixTime(claims.exp);
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (issuedAt > nowSeconds + clockSkewSeconds
      || notBefore > nowSeconds + clockSkewSeconds
      || expiresAt <= nowSeconds - clockSkewSeconds
      || expiresAt <= issuedAt
      || expiresAt - issuedAt > settings.maximumLifetimeSeconds) {
    throw new Error("Workload token lifetime is invalid");
  }

  validateKubernetesClaims(claims.sub, claims["kubernetes.io"]);
  return claims.sub;
}

function validateKubernetesClaims(
  subject: string,
  value: unknown
): void {
  if (!subject.startsWith(serviceAccountPrefix)
      || typeof value !== "object"
      || value === null) {
    throw new Error("Workload token binding is invalid");
  }

  const names = subject.slice(serviceAccountPrefix.length).split(":");
  const kubernetes = value as KubernetesClaims;
  const serviceAccount = kubernetes.serviceaccount as NamedClaim | undefined;
  const pod = kubernetes.pod as NamedClaim | undefined;
  if (names.length !== 2
      || kubernetes.namespace !== names[0]
      || typeof serviceAccount !== "object"
      || serviceAccount === null
      || serviceAccount.name !== names[1]
      || !isBoundIdentifier(serviceAccount.uid)
      || typeof pod !== "object"
      || pod === null
      || !isBoundIdentifier(pod.name)
      || !isBoundIdentifier(pod.uid)) {
    throw new Error("Workload token binding is invalid");
  }
}

function decodeJson<T>(value: string): T {
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.length < 2 || decoded.length > 16 * 1024) {
      throw new Error("JWT segment is outside its bound");
    }
    return JSON.parse(decoded.toString("utf8")) as T;
  } catch (error) {
    throw new Error("Workload token is malformed", { cause: error });
  }
}

function hasAudience(value: unknown, expected: string): boolean {
  return value === expected
    || Array.isArray(value) && value.includes(expected);
}

function readUnixTime(value: unknown): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error("Workload token time is invalid");
  }
  return value as number;
}

function isBoundIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 253
    && !/\s/u.test(value);
}
