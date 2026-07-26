import {
  createPublicKey,
  verify
} from "node:crypto";
import type {
  GetInvocationVerificationKeysResponse
} from "../generated/v1/identityd.js";
import type {
  InvocationIdentity
} from "./invocation-identity.js";
import {
  InvocationKeySourceError
} from "./invocation-key-source-error.js";
import type {
  InvocationValidationSettings
} from "./invocation-validation-settings.js";
import {
  InvocationValidationError
} from "./invocation-validation-error.js";

interface JwtHeader {
  readonly alg?: unknown;
  readonly kid?: unknown;
  readonly typ?: unknown;
}

interface JwtClaims {
  readonly iss?: unknown;
  readonly aud?: unknown;
  readonly sub?: unknown;
  readonly act?: unknown;
  readonly tenant_id?: unknown;
  readonly workspace_id?: unknown;
  readonly session_id?: unknown;
  readonly run_id?: unknown;
  readonly iat?: unknown;
  readonly nbf?: unknown;
  readonly exp?: unknown;
  readonly jti?: unknown;
  readonly [name: string]: unknown;
}

export function validateInvocationToken(
  token: string,
  response: GetInvocationVerificationKeysResponse,
  settings: InvocationValidationSettings,
  currentTime: Date
): InvocationIdentity {
  if (token.length > 16_384) {
    throw new InvocationValidationError();
  }
  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new InvocationValidationError();
  }
  const headerSegment = segments[0];
  const claimsSegment = segments[1];
  const signatureSegment = segments[2];
  if (
    headerSegment === undefined
    || claimsSegment === undefined
    || signatureSegment === undefined
  ) {
    throw new InvocationValidationError();
  }

  const header = decodeJson<JwtHeader>(headerSegment);
  const claims = decodeJson<JwtClaims>(claimsSegment);
  if (
    header.alg !== "RS256"
    || typeof header.kid !== "string"
    || header.kid.length < 1
    || header.kid.length > 128
    || header.typ !== "JWT"
  ) {
    throw new InvocationValidationError();
  }

  const key = loadVerificationKey(
    response,
    header.kid,
    currentTime);
  const signature = decodeBase64Url(signatureSegment);
  if (!verify(
    "RSA-SHA256",
    Buffer.from(`${headerSegment}.${claimsSegment}`),
    key,
    signature
  )) {
    throw new InvocationValidationError();
  }

  validateCommonClaims(claims, settings, currentTime);
  const subjectAccountId =
    readPrincipalId(claims.sub);
  const sessionId = readOptionalContextId(
    claims.session_id);
  const runId = readOptionalContextId(claims.run_id);
  if ((sessionId === undefined) === (runId === undefined)) {
    throw new InvocationValidationError();
  }

  const actorId = sessionId === undefined
    ? readRunActor(claims.act, subjectAccountId)
    : readSessionActor(claims.act, subjectAccountId);
  const tenantId = readOptionalScopeId(
    claims.tenant_id);
  const workspaceId = readOptionalScopeId(
    claims.workspace_id);
  if (
    workspaceId !== undefined
    && tenantId === undefined
  ) {
    throw new InvocationValidationError();
  }
  rejectAuthorityClaims(claims);

  return {
    subjectAccountId,
    actorId,
    ...(tenantId === undefined ? {} : { tenantId }),
    ...(workspaceId === undefined
      ? {}
      : { workspaceId })
  };
}

function loadVerificationKey(
  response: GetInvocationVerificationKeysResponse,
  keyId: string,
  currentTime: Date
) {
  if (
    response.keys.length < 1
    || response.keys.length > 8
    || response.expiresAt === undefined
    || !Number.isFinite(response.expiresAt.getTime())
    || response.expiresAt <= currentTime
    || response.expiresAt.getTime()
      > currentTime.getTime() + 5 * 60_000
  ) {
    throw new InvocationKeySourceError();
  }
  const seen = new Set<string>();
  for (const candidate of response.keys) {
    if (
      candidate.keyId.length < 1
      || candidate.keyId.length > 128
      || candidate.algorithm !== "RS256"
      || candidate.modulusBase64url.length < 1
      || candidate.exponentBase64url.length < 1
      || seen.has(candidate.keyId)
    ) {
      throw new InvocationKeySourceError();
    }
    seen.add(candidate.keyId);
  }

  const candidate = response.keys.find(
    (item) => item.keyId === keyId);
  if (candidate === undefined) {
    throw new InvocationValidationError();
  }
  try {
    return createPublicKey({
      key: {
        kty: "RSA",
        kid: candidate.keyId,
        alg: "RS256",
        use: "sig",
        n: candidate.modulusBase64url,
        e: candidate.exponentBase64url
      },
      format: "jwk"
    });
  } catch {
    throw new InvocationKeySourceError();
  }
}

function validateCommonClaims(
  claims: JwtClaims,
  settings: InvocationValidationSettings,
  currentTime: Date
): void {
  const now = Math.floor(currentTime.getTime() / 1_000);
  if (
    claims.iss !== settings.issuer
    || claims.aud !== settings.audience
    || !isInteger(claims.iat)
    || !isInteger(claims.nbf)
    || !isInteger(claims.exp)
    || claims.iat > now
    || claims.nbf > now
    || claims.nbf < claims.iat
    || claims.exp <= now
    || claims.exp <= claims.iat
    || claims.exp - claims.iat
      > settings.maximumLifetimeSeconds
  ) {
    throw new InvocationValidationError();
  }
  readContextId(claims.jti);
}

function readRunActor(
  value: unknown,
  subjectAccountId: string
): string {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || Object.keys(value).length !== 1
  ) {
    throw new InvocationValidationError();
  }
  const actorId = readPrincipalId(
    (value as { readonly sub?: unknown }).sub);
  if (actorId === subjectAccountId) {
    throw new InvocationValidationError();
  }
  return actorId;
}

function readSessionActor(
  value: unknown,
  subjectAccountId: string
): string {
  if (
    value !== undefined
    || !subjectAccountId.startsWith("user:")
  ) {
    throw new InvocationValidationError();
  }
  return subjectAccountId;
}

function readPrincipalId(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length > 256
    || !/^[a-z][a-z_]*:[a-z0-9][a-z0-9_.-]*$/u
      .test(value)
  ) {
    throw new InvocationValidationError();
  }
  return value;
}

function readOptionalScopeId(
  value: unknown
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string"
    || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value)
  ) {
    throw new InvocationValidationError();
  }
  return value;
}

function readOptionalContextId(
  value: unknown
): string | undefined {
  return value === undefined
    ? undefined
    : readContextId(value);
}

function readContextId(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^[a-z0-9][a-z0-9._~-]{0,127}$/u.test(value)
  ) {
    throw new InvocationValidationError();
  }
  return value;
}

function rejectAuthorityClaims(claims: JwtClaims): void {
  for (const name of [
    "role",
    "roles",
    "permission",
    "permissions",
    "scope",
    "scopes",
    "endpoint",
    "endpoints",
    "traceparent",
    "tracestate"
  ]) {
    if (claims[name] !== undefined) {
      throw new InvocationValidationError();
    }
  }
}

function decodeJson<T>(encoded: string): T {
  try {
    return JSON.parse(
      decodeBase64Url(encoded).toString("utf8")) as T;
  } catch {
    throw new InvocationValidationError();
  }
}

function decodeBase64Url(encoded: string): Buffer {
  if (
    encoded.length === 0
    || !/^[A-Za-z0-9_-]+$/u.test(encoded)
  ) {
    throw new InvocationValidationError();
  }
  const value = Buffer.from(encoded, "base64url");
  if (value.toString("base64url") !== encoded) {
    throw new InvocationValidationError();
  }
  return value;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value);
}
