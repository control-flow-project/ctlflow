import {
  createPublicKey,
  createVerify
} from "node:crypto";
import {
  type GetInvocationVerificationKeysResponse
} from "../generated/v1/identityd.js";
import type {
  InvocationTarget,
  InvocationValidationSettings,
  SignedInvocation
} from "./signed-invocation.js";

const clockSkewSeconds = 5;
const principalPattern = /^(?:user|service):[a-z0-9][a-z0-9._-]*$/u;
const virtualPrincipalPattern = /^agent:[a-z0-9][a-z0-9._-]*$/u;
const contextIdPattern = /^[a-z0-9][a-z0-9._~-]{0,127}$/u;
const scopeIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const forbiddenClaims = [
  "role",
  "roles",
  "permission",
  "permissions",
  "scope",
  "scopes",
  "endpoint",
  "endpoints",
  "capability",
  "capabilities",
  "grant",
  "grants",
  "kubernetes",
  "kubernetes.io",
  "traceparent",
  "tracestate"
] as const;

export function validateInvocation(
  invocation: SignedInvocation,
  keys: GetInvocationVerificationKeysResponse,
  settings: InvocationValidationSettings,
  target: InvocationTarget,
  currentTimeSeconds = Math.floor(Date.now() / 1_000)
): boolean {
  const key = keys.keys.find((item) => item.keyId === invocation.keyId);
  if (key === undefined) {
    return false;
  }
  const publicKey = createPublicKey({
    key: {
      kty: "RSA",
      n: key.modulusBase64url,
      e: key.exponentBase64url
    },
    format: "jwk"
  });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(invocation.signingInput);
  if (!verifier.verify(publicKey, invocation.signature)) {
    return false;
  }

  const payload = invocation.payload;
  if (payload.iss !== settings.issuer
      || !hasAudience(payload.aud, settings.audience)
      || hasForbiddenClaim(payload)) {
    return false;
  }

  const issuedAt = readInteger(payload.iat);
  const notBefore = readInteger(payload.nbf);
  const expiresAt = readInteger(payload.exp);
  if (issuedAt === undefined
      || notBefore === undefined
      || expiresAt === undefined
      || issuedAt > currentTimeSeconds + clockSkewSeconds
      || notBefore > currentTimeSeconds + clockSkewSeconds
      || expiresAt <= currentTimeSeconds - clockSkewSeconds
      || expiresAt <= issuedAt
      || expiresAt - issuedAt > settings.maximumLifetimeSeconds
      || !isContextId(payload.jti)) {
    return false;
  }

  const subject = payload.sub;
  if (typeof subject !== "string"
      || subject.length > 256
      || !principalPattern.test(subject)) {
    return false;
  }

  const sessionId = payload.session_id;
  const runId = payload.run_id;
  const hasSession = sessionId !== undefined;
  const hasRun = runId !== undefined;
  if (hasSession === hasRun
      || (hasSession && !isContextId(sessionId))
      || (hasRun && !isContextId(runId))
      || !hasValidActor(payload.act, subject, hasSession)) {
    return false;
  }

  const tenantId = payload.tenant_id;
  const workspaceId = payload.workspace_id;
  if (!isScopeId(target.tenantId)
      || tenantId !== target.tenantId
      || !isScopeId(tenantId)
      || (workspaceId !== undefined
        && (!isScopeId(workspaceId) || workspaceId !== target.workspaceId))
      || (target.workspaceId !== undefined
        && !isScopeId(target.workspaceId))) {
    return false;
  }

  return !(hasSession
    && (!subject.startsWith("user:") || payload.act !== undefined));
}

function hasForbiddenClaim(
  payload: Readonly<Record<string, unknown>>
): boolean {
  return Object.keys(payload).some(
    (name) => forbiddenClaims.some((forbidden) => name === forbidden)
      || name.startsWith("kubernetes.io/"));
}

function hasAudience(value: unknown, expected: string): boolean {
  return value === expected
    || (Array.isArray(value)
      && value.some((item) => item === expected));
}

function readInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function isContextId(value: unknown): boolean {
  return typeof value === "string" && contextIdPattern.test(value);
}

function isScopeId(value: unknown): value is string {
  return typeof value === "string" && scopeIdPattern.test(value);
}

function hasValidActor(
  value: unknown,
  subject: string,
  sessionOrigin: boolean
): boolean {
  if (value === undefined) {
    return true;
  }
  if (sessionOrigin
      || value === null
      || typeof value !== "object"
      || Array.isArray(value)) {
    return false;
  }
  const actor = value as Readonly<Record<string, unknown>>;
  return Object.keys(actor).length === 1
    && typeof actor.sub === "string"
    && actor.sub !== subject
    && actor.sub.length <= 256
    && virtualPrincipalPattern.test(actor.sub);
}
