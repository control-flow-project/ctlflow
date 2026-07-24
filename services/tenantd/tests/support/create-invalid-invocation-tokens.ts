import type { InvocationAuthority } from "./invocation-authority.js";

export function createInvalidInvocationTokens(
  authority: InvocationAuthority
): readonly string[] {
  const now = Math.floor(Date.now() / 1_000);
  const duplicateSubject = authority.signPayload(
    `{"iss":"${authority.issuer}","aud":"${authority.audience}",`
    + `"sub":"user:alice","sub":"user:bob","iat":${String(now)},`
    + `"nbf":${String(now)},"exp":${String(now + 30)},`
    + "\"session_id\":\"session-test\",\"tenant_id\":\"tenant_active\","
    + "\"jti\":\"duplicate-subject\"}");

  return [
    authority.sign({
      tenantId: "tenant_active",
      issuedAt: now - 120,
      notBefore: now - 120,
      expiresAt: now - 60
    }),
    authority.sign({
      tenantId: "tenant_active",
      notBefore: now + 60
    }),
    authority.sign({
      tenantId: "tenant_active",
      issuedAt: now,
      expiresAt: now + 61
    }),
    authority.sign({
      tenantId: "tenant_active",
      audience: "wrong-audience"
    }),
    authority.sign({
      tenantId: "tenant_active",
      issuer: "https://wrong-issuer.test"
    }),
    corruptSignature(authority.sign({ tenantId: "tenant_active" })),
    authority.sign({
      tenantId: "tenant_active",
      authorityClaim: true
    }),
    authority.sign({
      tenantId: "tenant_active",
      subject: "job:not-an-account"
    }),
    authority.sign({
      tenantId: "tenant_active",
      sessionId: null
    }),
    authority.sign({
      tenantId: "tenant_active",
      runId: "run-test"
    }),
    authority.sign({
      tenantId: "tenant_active",
      actorSubject: "job:reviewer"
    }),
    authority.sign({
      tenantId: "tenant_active",
      subject: "service:automation"
    }),
    authority.sign({ sessionId: "session-global" }),
    authority.sign({
      tenantId: "tenant_active",
      sessionId: null,
      runId: "run-test"
    }),
    authority.sign({
      tenantId: "tenant_active",
      subject: "service:automation",
      sessionId: null,
      runId: "run-test",
      actorSubject: "service:automation"
    }),
    authority.sign({
      workspaceId: "workspace_one",
      sessionId: null,
      runId: "run-test",
      actorSubject: "job:reviewer"
    }),
    authority.sign({
      tenantId: "tenant_active",
      workspaceId: "Workspace",
      sessionId: null,
      runId: "run-test",
      actorSubject: "job:reviewer"
    }),
    authority.sign({
      tenantId: "tenant_active",
      tokenId: "invalid token"
    }),
    duplicateSubject
  ];
}

function corruptSignature(token: string): string {
  const segments = token.split(".");
  const signature = segments[2];
  if (segments.length !== 3
      || signature === undefined
      || signature.length === 0) {
    throw new Error("Cannot corrupt a malformed invocation token");
  }

  const replacement = signature[0] === "A" ? "B" : "A";
  return `${segments[0]!}.${segments[1]!}.${replacement}${signature.slice(1)}`;
}
