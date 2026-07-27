import {
  readFile
} from "node:fs/promises";
import http, {
  type IncomingMessage,
  type ServerResponse
} from "node:http";
import https from "node:https";
import type {
  EgressRequestEvidence
} from "./egress-request-evidence.js";
import type {
  EgressdMode
} from "./egressd-mode.js";

const proxyPort = readPort("CTLFLOW_TEST_EGRESS_PROXY_PORT");
const controlPort = readPort("CTLFLOW_TEST_EGRESS_CONTROL_PORT");
const upstreamOrigin = new URL(
  requireEnvironment("CTLFLOW_TEST_EGRESS_UPSTREAM_ORIGIN"));
const upstreamAuthority = requireEnvironment(
  "CTLFLOW_TEST_EGRESS_UPSTREAM_AUTHORITY");
const upstreamServerName = requireEnvironment(
  "CTLFLOW_TEST_EGRESS_UPSTREAM_SERVER_NAME");
const upstreamAuthorityCertificate = await readFile(
  requireEnvironment("CTLFLOW_TEST_EGRESS_UPSTREAM_CA_PATH"));
const evidence: EgressRequestEvidence[] = [];
let mode: EgressdMode = "available";

const proxy = http.createServer(async (request, response) => {
  let captured: EgressRequestEvidence;
  try {
    captured = await captureRequest(request);
  } catch {
    respond(response, 400);
    return;
  }
  evidence.push(captured);
  if (mode === "unavailable") {
    respond(response, 503);
    return;
  }
  if (mode === "delayed") {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  try {
    await forwardRequest(request, captured, response);
  } catch {
    respond(response, 503);
  }
});
await listen(proxy, proxyPort);

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

async function captureRequest(
  request: IncomingMessage
): Promise<EgressRequestEvidence> {
  if (request.method !== "POST" && request.method !== "GET"
      || request.url !== "/token" && request.url !== "/userinfo"
      || request.headers.host !== upstreamAuthority
      || request.headers.accept !== "application/json"
      || typeof request.headers.authorization !== "string") {
    throw new Error("Request is outside the OIDC binding");
  }
  const token = request.method === "POST" && request.url === "/token";
  const userInfo =
    request.method === "GET" && request.url === "/userinfo";
  if (!token && !userInfo
      || token
        && request.headers["content-type"]
          !== "application/x-www-form-urlencoded"
      || userInfo && request.headers["content-type"] !== undefined) {
    throw new Error("Request shape is outside the OIDC binding");
  }
  const body = await readBody(request, token ? 8 * 1024 : 0);
  if (userInfo && body.length !== 0) {
    throw new Error("UserInfo body is forbidden");
  }
  return {
    method: request.method,
    path: request.url,
    host: request.headers.host,
    authorization: request.headers.authorization,
    accept: request.headers.accept,
    ...(request.headers["content-type"] === undefined
      ? {}
      : { contentType: request.headers["content-type"] }),
    ...(request.headers["content-length"] === undefined
      ? {}
      : { contentLength: request.headers["content-length"] }),
    ...(typeof request.headers.traceparent !== "string"
      ? {}
      : { traceparent: request.headers.traceparent }),
    ...(typeof request.headers.tracestate !== "string"
      ? {}
      : { tracestate: request.headers.tracestate }),
    body
  };
}

async function forwardRequest(
  _incoming: IncomingMessage,
  captured: EgressRequestEvidence,
  response: ServerResponse
): Promise<void> {
  const target = new URL(captured.path, upstreamOrigin);
  const upstream = await new Promise<{
    readonly statusCode: number;
    readonly contentType?: string;
    readonly body: Buffer;
  }>((resolve, reject) => {
    const request = https.request(
      target,
      {
        method: captured.method,
        ca: upstreamAuthorityCertificate,
        servername: upstreamServerName,
        headers: {
          host: upstreamAuthority,
          accept: captured.accept,
          authorization: captured.authorization,
          ...(captured.contentType === undefined
            ? {}
            : { "content-type": captured.contentType }),
          ...(captured.body.length === 0
            ? {}
            : {
                "content-length":
                  String(Buffer.byteLength(captured.body))
              })
        }
      },
      async (upstreamResponse) => {
        try {
          resolve({
            statusCode: upstreamResponse.statusCode ?? 502,
            ...(upstreamResponse.headers["content-type"] === undefined
              ? {}
              : {
                  contentType:
                    upstreamResponse.headers["content-type"]
                }),
            body: Buffer.from(
              await readBody(upstreamResponse, 256 * 1024))
          });
        } catch (error) {
          reject(error);
        }
      });
    request.once("error", reject);
    request.setTimeout(5_000, () =>
      request.destroy(new Error("upstream deadline")));
    request.end(captured.body);
  });
  response.writeHead(
    upstream.statusCode,
    upstream.contentType === undefined
      ? {}
      : { "content-type": upstream.contentType });
  response.end(upstream.body);
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
    response.end(JSON.stringify(evidence));
    return;
  }
  if (request.method === "DELETE" && request.url === "/evidence") {
    evidence.length = 0;
    respond(response, 204);
    return;
  }
  if (request.method === "PUT" && request.url === "/mode") {
    const value = JSON.parse(await readBody(request, 1_024)) as {
      readonly mode?: unknown;
    };
    if (value.mode !== "available"
        && value.mode !== "unavailable"
        && value.mode !== "delayed") {
      throw new Error("Invalid Egressd mode");
    }
    mode = value.mode;
    respond(response, 204);
    return;
  }
  respond(response, 404);
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
      throw new Error("Body exceeds binding limit");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function respond(response: ServerResponse, statusCode: number): void {
  response.writeHead(statusCode);
  response.end();
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
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

function shutdown(): void {
  proxy.close();
  control.close();
}
