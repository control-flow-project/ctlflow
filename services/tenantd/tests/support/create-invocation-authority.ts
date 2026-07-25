import {
  createSign,
  generateKeyPairSync,
  type JsonWebKey,
  type KeyObject
} from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  InvocationAuthority,
  InvocationTokenOptions
} from "./invocation-authority.js";

const issuer = "https://identity.test";
const audience = "ctlflow-internal";
const keyId = "invocation-test-key";

export async function createInvocationAuthority(
  repositoryRoot: string
):
Promise<InvocationAuthority> {
  const root = path.join(
    repositoryRoot,
    ".temp",
    "tests",
    "invocation");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(
    path.join(root, "authority-"));
  const jwksPath = path.join(directory, "invocation-jwks.json");
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2_048
  });
  const publicJwk = keys.publicKey.export({
    format: "jwk"
  });

  await writeFile(
    jwksPath,
    JSON.stringify({
      keys: [
        createVerificationJwk(publicJwk)
      ]
    }),
    "utf8");

  return {
    issuer,
    audience,
    jwksPath,
    sign: (options = {}) => signInvocationToken(keys.privateKey, options),
    signPayload: (payloadJson) => signPayload(keys.privateKey, payloadJson),
    stop: () => Promise.resolve()
  };
}

function createVerificationJwk(jwk: JsonWebKey): JsonWebKey {
  if (jwk.n === undefined || jwk.e === undefined) {
    throw new Error("RSA key export did not include public parameters");
  }

  return {
    kty: "RSA",
    kid: keyId,
    use: "sig",
    alg: "RS256",
    n: jwk.n,
    e: jwk.e
  };
}

function signInvocationToken(
  privateKey: KeyObject,
  options: InvocationTokenOptions
): string {
  const now = Math.floor(Date.now() / 1_000);
  const issuedAt = options.issuedAt ?? now;
  const payload: Record<string, unknown> = {
    iss: options.issuer ?? issuer,
    aud: options.audience ?? audience,
    sub: options.subject ?? "user:alice",
    iat: issuedAt,
    nbf: options.notBefore ?? issuedAt,
    exp: options.expiresAt ?? issuedAt + 30,
    jti: options.tokenId ?? `invocation-${String(now)}`
  };

  if (options.sessionId !== null) {
    payload.session_id = options.sessionId ?? "session-test";
  }
  if (options.runId !== undefined) {
    payload.run_id = options.runId;
  }
  if (options.tenantId !== undefined) {
    payload.tenant_id = options.tenantId;
  }
  if (options.workspaceId !== undefined) {
    payload.workspace_id = options.workspaceId;
  }
  if (options.actorSubject !== undefined) {
    payload.act = {
      sub: options.actorSubject
    };
  }
  if (options.authorityClaim === true) {
    payload.roles = "admin";
  }

  return signPayload(privateKey, JSON.stringify(payload));
}

function signPayload(
  privateKey: KeyObject,
  payloadJson: string
): string {
  const header = encodeJson({
    alg: "RS256",
    kid: keyId,
    typ: "JWT"
  });
  const claims = Buffer.from(payloadJson, "utf8").toString("base64url");
  const signingInput = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
