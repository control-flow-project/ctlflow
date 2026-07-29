import {
  createHash,
  createPrivateKey,
  randomBytes,
  sign
} from "node:crypto";
import {
  readFile
} from "node:fs/promises";
import http, {
  type IncomingMessage,
  type ServerResponse
} from "node:http";
import https from "node:https";
import type {
  AuthorizationEvidence,
  OidcProviderEvidence,
  TokenEvidence,
  UserInfoEvidence
} from "./oidc-provider-evidence.js";
import type {
  OidcProviderMode
} from "./oidc-provider-mode.js";

interface AuthorizationCode {
  readonly challenge: string;
  readonly subject: string;
  readonly expiresAt: number;
}

const httpsPort = readPort("CTLFLOW_TEST_OIDC_HTTPS_PORT");
const controlPort = readPort("CTLFLOW_TEST_OIDC_CONTROL_PORT");
const origin = requireEnvironment("CTLFLOW_TEST_OIDC_ORIGIN");
const callbackUri = requireEnvironment(
  "CTLFLOW_TEST_OIDC_CALLBACK_URI");
const clientId = requireEnvironment("CTLFLOW_TEST_OIDC_CLIENT_ID");
const clientSecret = requireEnvironment(
  "CTLFLOW_TEST_OIDC_CLIENT_SECRET");
const keyId = requireEnvironment("CTLFLOW_TEST_OIDC_KEY_ID");
const certificate = await readFile(
  requireEnvironment("CTLFLOW_TEST_OIDC_TLS_CERTIFICATE_PATH"));
const privateKey = await readFile(
  requireEnvironment("CTLFLOW_TEST_OIDC_TLS_PRIVATE_KEY_PATH"));
const signingKey = createPrivateKey(await readFile(
  requireEnvironment(
    "CTLFLOW_TEST_OIDC_SIGNING_PRIVATE_KEY_PATH")));
const codes = new Map<string, AuthorizationCode>();
const accessTokens = new Map<string, string>();
const evidence: {
  authorizations: AuthorizationEvidence[];
  tokens: TokenEvidence[];
  userInfo: UserInfoEvidence[];
} = {
  authorizations: [],
  tokens: [],
  userInfo: []
};
let mode: OidcProviderMode = "available";

const provider = https.createServer(
  { cert: certificate, key: privateKey },
  async (request, response) => {
    try {
      if (request.method === "GET"
          && request.url?.startsWith("/authorize?") === true) {
        handleAuthorization(request, response);
        return;
      }
      if (request.method === "POST" && request.url === "/token") {
        await handleToken(request, response);
        return;
      }
      if (request.method === "GET" && request.url === "/userinfo") {
        await handleUserInfo(request, response);
        return;
      }
      respond(response, 404);
    } catch {
      respond(response, 400);
    }
  });
await listen(provider, httpsPort);

const control = http.createServer(async (request, response) => {
  try {
    await handleControl(request, response);
  } catch {
    respond(response, 400);
  }
});
await listen(control, controlPort);

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

function handleAuthorization(
  request: IncomingMessage,
  response: ServerResponse)
: void {
  const url = new URL(request.url!, origin);
  const parameters = [...url.searchParams.entries()]
    .map(([name, value]) => ({ name, value }));
  evidence.authorizations.push({ parameters });
  const expectedNames = [
    "response_type",
    "client_id",
    "redirect_uri",
    "scope",
    "state",
    "code_challenge",
    "code_challenge_method"
  ];
  if (parameters.length !== expectedNames.length
      || parameters.some(
        (item, index) => item.name !== expectedNames[index])
      || url.searchParams.get("response_type") !== "code"
      || url.searchParams.get("client_id") !== clientId
      || url.searchParams.get("redirect_uri") !== callbackUri
      || url.searchParams.get("scope") !== "openid"
      || url.searchParams.get("code_challenge_method") !== "S256") {
    throw new Error("Authorization request is invalid");
  }
  const state = url.searchParams.get("state")!;
  const challenge = url.searchParams.get("code_challenge")!;
  if (!isBase64Url32(state) || !isBase64Url32(challenge)) {
    throw new Error("Authorization state or challenge is invalid");
  }
  if (mode === "authorization_error") {
    redirect(
      response,
      `${callbackUri}?state=${encodeURIComponent(state)}`
      + "&error=access_denied&error_description=Denied");
    return;
  }

  const code = encodeBase64Url(randomBytes(32));
  codes.set(code, {
    challenge,
    subject: "alice@example.com",
    expiresAt: Date.now() + 60_000
  });
  redirect(
    response,
    `${callbackUri}?state=${encodeURIComponent(state)}`
    + `&code=${encodeURIComponent(code)}`);
}

async function handleToken(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readBody(request, 8 * 1024);
  evidence.tokens.push({
    authorization: request.headers.authorization ?? "",
    body,
    ...(typeof request.headers.traceparent !== "string"
      ? {}
      : { traceparent: request.headers.traceparent }),
    ...(typeof request.headers.tracestate !== "string"
      ? {}
      : { tracestate: request.headers.tracestate })
  });
  if (request.headers.accept !== "application/json"
      || request.headers["content-type"]
        !== "application/x-www-form-urlencoded"
      || request.headers.authorization
        !== `Basic ${createExpectedBasic()}`) {
    throw new Error("Token request headers are invalid");
  }
  const fields = [...new URLSearchParams(body).entries()];
  const expectedNames = [
    "grant_type",
    "code",
    "redirect_uri",
    "code_verifier"
  ];
  if (fields.length !== expectedNames.length
      || fields.some(([name], index) => name !== expectedNames[index])
      || fields[0]?.[1] !== "authorization_code"
      || fields[2]?.[1] !== callbackUri) {
    throw new Error("Token form is invalid");
  }
  const code = fields[1]?.[1] ?? "";
  const verifier = fields[3]?.[1] ?? "";
  const authorization = codes.get(code);
  codes.delete(code);
  if (authorization === undefined
      || authorization.expiresAt <= Date.now()
      || encodeBase64Url(
        createHash("sha256").update(verifier, "ascii").digest())
        !== authorization.challenge) {
    respond(response, 401);
    return;
  }
  if (mode === "token_rejected") {
    respond(response, 401);
    return;
  }
  if (mode === "token_unavailable") {
    respond(response, 503);
    return;
  }
  if (mode === "token_slow") {
    await delay(
      500 + ((evidence.tokens.length - 1) % 32) * 20);
  }
  if (mode === "token_delayed") {
    await delay(6_000);
  }
  if (mode === "token_invalid_json") {
    json(response, 200, "{");
    return;
  }
  if (mode === "token_duplicate_member") {
    json(
      response,
      200,
      '{"access_token":"first","access_token":"second",'
      + '"token_type":"Bearer","id_token":"a.b.c"}');
    return;
  }
  if (mode === "token_oversized") {
    response.writeHead(200, {
      "content-type": "application/json"
    });
    response.end("x".repeat(256 * 1024 + 1));
    return;
  }

  const accessToken = encodeBase64Url(randomBytes(32));
  const tokenSubject = mode === "unknown_subject"
    ? "unknown@example.com"
    : authorization.subject;
  accessTokens.set(accessToken, tokenSubject);
  const idToken = createIdToken(
    tokenSubject,
    accessToken);
  const contentType = mode === "token_bad_content_type"
    ? "text/plain"
    : "application/json";
  const tokenResponse: Record<string, unknown> = {
    access_token: mode === "token_invalid_values"
      ? "="
      : accessToken,
    token_type: mode === "token_invalid_values"
      ? "DPoP"
      : "Bearer",
    id_token: idToken
  };
  if (mode === "token_extra_members") {
    tokenResponse.refresh_token = "ignored-refresh-token";
    tokenResponse.extension = { ignored: true };
  }
  response.writeHead(200, { "content-type": contentType });
  response.end(JSON.stringify(tokenResponse));
}

async function handleUserInfo(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  evidence.userInfo.push({
    authorization: request.headers.authorization ?? "",
    ...(typeof request.headers.traceparent !== "string"
      ? {}
      : { traceparent: request.headers.traceparent }),
    ...(typeof request.headers.tracestate !== "string"
      ? {}
      : { tracestate: request.headers.tracestate })
  });
  if (request.headers.accept !== "application/json"
      || typeof request.headers.authorization !== "string"
      || !request.headers.authorization.startsWith("Bearer ")) {
    throw new Error("UserInfo request headers are invalid");
  }
  const token = request.headers.authorization.slice("Bearer ".length);
  const subject = accessTokens.get(token);
  if (subject === undefined) {
    respond(response, 401);
    return;
  }
  if (mode === "userinfo_rejected") {
    respond(response, 401);
    return;
  }
  if (mode === "userinfo_unavailable") {
    respond(response, 503);
    return;
  }
  if (mode === "userinfo_delayed") {
    await delay(6_000);
  }
  if (mode === "userinfo_invalid_json") {
    json(response, 200, "{");
    return;
  }
  if (mode === "userinfo_duplicate_member") {
    json(response, 200, '{"sub":"first","sub":"second"}');
    return;
  }
  if (mode === "userinfo_oversized") {
    response.writeHead(200, {
      "content-type": "application/json"
    });
    response.end("x".repeat(256 * 1024 + 1));
    return;
  }
  const contentType = mode === "userinfo_bad_content_type"
    ? "application/jwt"
    : "application/json";
  response.writeHead(200, { "content-type": contentType });
  response.end(JSON.stringify({
    sub: mode === "subject_mismatch"
      ? "mallory@example.com"
      : mode === "userinfo_invalid_subject"
        ? "\u0000"
        : subject
  }));
}

function createIdToken(subject: string, accessToken: string): string {
  const now = Math.floor(Date.now() / 1_000);
  const claims: Record<string, unknown> = {
    iss: mode === "invalid_issuer" ? `${origin}/other` : `${origin}/issuer`,
    aud: mode === "invalid_audience"
      ? "another-client"
      : mode === "audience_array"
        ? [clientId]
        : clientId,
    exp: mode === "expired" ? now - 120 : now + 300,
    iat: mode === "future_iat"
      ? now + 120
      : mode === "old_iat"
        ? now - 1_200
        : now,
    sub: subject,
    at_hash: mode === "bad_at_hash"
      ? encodeBase64Url(randomBytes(16))
      : createAccessTokenHash(accessToken)
  };
  if (mode === "audience_array") {
    claims.azp = clientId;
  }
  if (mode === "missing_id_token_subject") {
    delete claims.sub;
  }
  if (mode === "future_nbf") {
    claims.nbf = now + 120;
  }
  const header = encodeJson({
    alg: mode === "invalid_id_token_header" ? "HS256" : "RS256",
    kid: keyId,
    typ: "JWT"
  });
  const payload = encodeJson(claims);
  const signed = `${header}.${payload}`;
  let signature = encodeBase64Url(sign(
    "RSA-SHA256",
    Buffer.from(signed, "ascii"),
    signingKey));
  if (mode === "invalid_signature") {
    signature = `${signature.slice(0, -1)}${
      signature.endsWith("A") ? "B" : "A"}`;
  }
  return `${signed}.${signature}`;
}

async function handleControl(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (request.method === "GET" && request.url === "/readyz") {
    respond(response, 204);
    return;
  }
  if (request.method === "GET" && request.url === "/evidence") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(evidence satisfies OidcProviderEvidence));
    return;
  }
  if (request.method === "DELETE" && request.url === "/evidence") {
    evidence.authorizations.length = 0;
    evidence.tokens.length = 0;
    evidence.userInfo.length = 0;
    codes.clear();
    accessTokens.clear();
    respond(response, 204);
    return;
  }
  if (request.method === "PUT" && request.url === "/mode") {
    const value = JSON.parse(await readBody(request, 1_024)) as {
      readonly mode?: unknown;
    };
    if (!isMode(value.mode)) {
      throw new Error("OIDC provider mode is invalid");
    }
    mode = value.mode;
    respond(response, 204);
    return;
  }
  respond(response, 404);
}

function createExpectedBasic(): string {
  const material = `${formEncode(clientId)}:${formEncode(clientSecret)}`;
  return Buffer.from(material, "ascii").toString("base64");
}

function formEncode(value: string): string {
  return encodeURIComponent(value)
    .replaceAll("%20", "+")
    .replace(/[!'()*]/gu, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function createAccessTokenHash(value: string): string {
  return encodeBase64Url(
    createHash("sha256").update(value, "ascii").digest().subarray(0, 16));
}

function encodeJson(value: unknown): string {
  return encodeBase64Url(
    Buffer.from(JSON.stringify(value), "utf8"));
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function isBase64Url32(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/u.test(value);
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(303, { location });
  response.end();
}

function json(
  response: ServerResponse,
  statusCode: number,
  body: string
): void {
  response.writeHead(
    statusCode,
    { "content-type": "application/json" });
  response.end(body);
}

function respond(response: ServerResponse, statusCode: number): void {
  response.writeHead(statusCode);
  response.end();
}

async function readBody(
  request: IncomingMessage,
  maximumBytes: number
): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk);
    length += buffer.length;
    if (length > maximumBytes) {
      throw new Error("Body is too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function listen(
  server: http.Server | https.Server,
  port: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readPort(name: string): number {
  const value = Number(requireEnvironment(name));
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isMode(value: unknown): value is OidcProviderMode {
  return typeof value === "string" && new Set<OidcProviderMode>([
    "available",
    "authorization_error",
    "token_rejected",
    "token_unavailable",
    "token_slow",
    "token_delayed",
    "token_bad_content_type",
    "token_invalid_json",
    "token_duplicate_member",
    "token_invalid_values",
    "token_oversized",
    "token_extra_members",
    "invalid_signature",
    "invalid_id_token_header",
    "invalid_issuer",
    "invalid_audience",
    "audience_array",
    "missing_id_token_subject",
    "expired",
    "future_iat",
    "old_iat",
    "future_nbf",
    "bad_at_hash",
    "userinfo_rejected",
    "userinfo_unavailable",
    "userinfo_delayed",
    "userinfo_bad_content_type",
    "userinfo_invalid_json",
    "userinfo_duplicate_member",
    "userinfo_invalid_subject",
    "userinfo_oversized",
    "subject_mismatch",
    "unknown_subject"
  ]).has(value as OidcProviderMode);
}

function shutdown(): void {
  provider.close();
  control.close();
}
