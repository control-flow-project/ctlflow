import {
  createSign,
  generateKeyPairSync,
  randomUUID,
  type JsonWebKey,
  type KeyObject
} from "node:crypto";
import {
  writeFile
} from "node:fs/promises";
import type {
  InvocationAuthority,
  InvocationTokenOptions
} from "./invocation-authority.js";
import {
  invocationAudience,
  invocationIssuer
} from "./invocation-settings.js";
import {
  VerificationKeyAlgorithm
} from "../generated/v1/identityd.js";

export async function createInvocationAuthority(
  keyId = `key_${randomUUID().replaceAll("-", "")}`
):
Promise<InvocationAuthority> {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2_048
  });
  const publicJwk = keys.publicKey.export({
    format: "jwk"
  });

  return {
    issuer: invocationIssuer,
    audience: invocationAudience,
    verificationKey: createVerificationKey(
      keyId,
      publicJwk),
    sign: (options = {}) =>
      signInvocationToken(
        keyId,
        keys.privateKey,
        options),
    signPayload: (payloadJson) =>
      signPayload(
        keyId,
        keys.privateKey,
        payloadJson),
    writePrivateKey: async (filePath) => {
      await writeFile(
        filePath,
        keys.privateKey.export({
          format: "pem",
          type: "pkcs8"
        }),
        { mode: 0o600 });
    }
  };
}

function createVerificationKey(
  keyId: string,
  jwk: JsonWebKey
): InvocationAuthority["verificationKey"] {
  if (jwk.n === undefined || jwk.e === undefined) {
    throw new Error("RSA key export did not include public parameters");
  }

  return {
    keyId,
    algorithm:
      VerificationKeyAlgorithm.VERIFICATION_KEY_ALGORITHM_RS256,
    modulusBase64url: jwk.n,
    exponentBase64url: jwk.e
  };
}

function signInvocationToken(
  keyId: string,
  privateKey: KeyObject,
  options: InvocationTokenOptions
): string {
  const now = Math.floor(Date.now() / 1_000);
  const issuedAt = options.issuedAt ?? now;
  const payload: Record<string, unknown> = {
    iss: options.issuer ?? invocationIssuer,
    aud: options.audience ?? invocationAudience,
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

  return signPayload(
    keyId,
    privateKey,
    JSON.stringify(payload));
}

function signPayload(
  keyId: string,
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
