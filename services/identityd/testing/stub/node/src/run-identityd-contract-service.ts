import {
  Server,
  ServerCredentials,
  status,
  type handleUnaryCall,
  type ServerUnaryCall,
  type sendUnaryData
} from "@grpc/grpc-js";
import {
  loadWorkloadVerificationKeys,
  validateWorkloadToken,
  type WorkloadVerificationSettings
} from "@ctlflow/test-mesh";
import {
  readFile
} from "node:fs/promises";
import http from "node:http";
import {
  IdentityServiceService,
  type GetInvocationVerificationKeysRequest,
  type GetInvocationVerificationKeysResponse
} from "../generated/v1/identityd.js";
import type {
  IdentitydMode
} from "./identityd-mode.js";
import type {
  IdentitydRequestEvidence
} from "./identityd-request-evidence.js";
import type {
  InvocationVerificationKeyResponse
} from "./invocation-verification-key.js";

interface Source {
  readonly callerSubject: string;
  mode: IdentitydMode;
  response: InvocationVerificationKeyResponse;
  readonly requests: IdentitydRequestEvidence[];
}

const grpcPort = readPort("CTLFLOW_TEST_IDENTITY_GRPC_PORT");
const controlPort = readPort("CTLFLOW_TEST_IDENTITY_CONTROL_PORT");
const workloadSettings = readWorkloadSettings();
const workloadKeys = await loadWorkloadVerificationKeys(
  workloadSettings.keySetPath);
const certificate = await readFile(
  requireEnvironment("CTLFLOW_TEST_TLS_CERTIFICATE_PATH"));
const privateKey = await readFile(
  requireEnvironment("CTLFLOW_TEST_TLS_PRIVATE_KEY_PATH"));
const sources = new Map<string, Source>();
const server = new Server();
server.addService(IdentityServiceService, {
  getInvocationVerificationKeys:
    getInvocationVerificationKeys as handleUnaryCall<
      GetInvocationVerificationKeysRequest,
      GetInvocationVerificationKeysResponse
    >
});
await new Promise<void>((resolve, reject) => {
  server.bindAsync(
    `0.0.0.0:${String(grpcPort)}`,
    ServerCredentials.createSsl(
      null,
      [{
        cert_chain: certificate,
        private_key: privateKey
      }],
      false),
    (error) => {
      if (error === null) {
        resolve();
      } else {
        reject(error);
      }
    });
});

const control = http.createServer(async (request, response) => {
  try {
    await handleControl(request, response);
  } catch (error) {
    response.writeHead(400, {
      "content-type": "text/plain"
    });
    response.end(
      error instanceof Error
        ? error.message
        : "invalid request");
  }
});
await new Promise<void>((resolve, reject) => {
  control.once("error", reject);
  control.listen(controlPort, "0.0.0.0", resolve);
});

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

function getInvocationVerificationKeys(
  call: ServerUnaryCall<
    GetInvocationVerificationKeysRequest,
    GetInvocationVerificationKeysResponse
  >,
  callback: sendUnaryData<
    GetInvocationVerificationKeysResponse>
): void {
  const source = authenticate(
    call.metadata.get("authorization"));
  if (source === undefined) {
    callback({
      code: status.UNAUTHENTICATED,
      message: "unauthenticated"
    });
    return;
  }
  if (source.mode === "unavailable") {
    callback({
      code: status.UNAVAILABLE,
      message: "unavailable"
    });
    return;
  }
  if (source.mode === "denied") {
    callback({
      code: status.PERMISSION_DENIED,
      message: "denied"
    });
    return;
  }

  source.requests.push({
    ...readTraceparent(call.metadata.get("traceparent"))
  });
  callback(null, {
    keys: source.response.keys.map((key) => ({
      ...key
    })),
    expiresAt: new Date(source.response.expiresAt)
  });
}

function authenticate(
  values: readonly (string | Buffer)[]
): Source | undefined {
  if (
    values.length !== 1
    || typeof values[0] !== "string"
    || !values[0].startsWith("Bearer ")
  ) {
    return undefined;
  }
  try {
    const subject = validateWorkloadToken(
      values[0].slice("Bearer ".length),
      workloadSettings,
      workloadKeys);
    return [...sources.values()].find(
      (source) => source.callerSubject === subject);
  } catch {
    return undefined;
  }
}

async function handleControl(
  request: http.IncomingMessage,
  response: http.ServerResponse
): Promise<void> {
  if (request.url === "/readyz") {
    response.writeHead(204);
    response.end();
    return;
  }
  const segments = new URL(
    request.url ?? "/",
    "http://localhost").pathname
    .split("/")
    .filter(Boolean);
  if (
    request.method === "POST"
    && segments.length === 1
    && segments[0] === "sources"
  ) {
    const body = await readBody(request) as {
      readonly sourceId: string;
      readonly callerSubject: string;
      readonly response: InvocationVerificationKeyResponse;
    };
    if (
      sources.has(body.sourceId)
      || !isServiceAccountSubject(body.callerSubject)
      || [...sources.values()].some(
        (source) =>
          source.callerSubject === body.callerSubject)
    ) {
      throw new Error("source is invalid");
    }
    sources.set(body.sourceId, {
      callerSubject: body.callerSubject,
      mode: "available",
      response: body.response,
      requests: []
    });
    sendJson(response, 201, {});
    return;
  }
  const sourceId = segments[1];
  const source = sourceId === undefined
    ? undefined
    : sources.get(sourceId);
  if (segments[0] !== "sources" || source === undefined) {
    throw new Error("source was not found");
  }
  if (
    request.method === "GET"
    && segments[2] === "requests"
  ) {
    sendJson(response, 200, source.requests);
    return;
  }
  if (
    request.method === "PUT"
    && segments[2] === "mode"
  ) {
    const body = await readBody(request) as {
      readonly mode: IdentitydMode;
    };
    if (
      !["available", "unavailable", "denied"]
        .includes(body.mode)
    ) {
      throw new Error("mode is invalid");
    }
    source.mode = body.mode;
    sendJson(response, 204, undefined);
    return;
  }
  if (
    request.method === "PUT"
    && segments[2] === "response"
  ) {
    source.response = await readBody(request) as
      InvocationVerificationKeyResponse;
    sendJson(response, 204, undefined);
    return;
  }
  if (
    request.method === "DELETE"
    && segments.length === 2
  ) {
    sources.delete(sourceId!);
    sendJson(response, 204, undefined);
    return;
  }
  throw new Error("control operation is invalid");
}

async function readBody(
  request: http.IncomingMessage
): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(
    Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  value: unknown
): void {
  if (value === undefined) {
    response.writeHead(statusCode);
    response.end();
    return;
  }
  response.writeHead(statusCode, {
    "content-type": "application/json"
  });
  response.end(JSON.stringify(value));
}

function readPort(name: string): number {
  const value = Number(process.env[name]);
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > 65_535
  ) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function readWorkloadSettings():
WorkloadVerificationSettings {
  const maximumLifetimeSeconds = Number(
    requireEnvironment(
      "CTLFLOW_TEST_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS"));
  if (
    !Number.isSafeInteger(maximumLifetimeSeconds)
    || maximumLifetimeSeconds < 1
  ) {
    throw new Error(
      "Workload token maximum lifetime is invalid");
  }
  return {
    issuer: requireEnvironment(
      "CTLFLOW_TEST_WORKLOAD_TOKEN_ISSUER"),
    audience: requireEnvironment(
      "CTLFLOW_TEST_WORKLOAD_TOKEN_AUDIENCE"),
    maximumLifetimeSeconds,
    keySetPath: requireEnvironment(
      "CTLFLOW_TEST_WORKLOAD_JWKS_PATH")
  };
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readTraceparent(
  values: readonly (string | Buffer)[]
): IdentitydRequestEvidence {
  return values.length === 1
      && typeof values[0] === "string"
    ? {
        receivedTraceparent: values[0]
      }
    : {};
}

function isServiceAccountSubject(value: string): boolean {
  const names = value
    .replace(/^system:serviceaccount:/u, "")
    .split(":");
  return value.startsWith("system:serviceaccount:")
    && names.length === 2
    && names.every((name) =>
      /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/u
        .test(name));
}

function shutdown(): void {
  control.close();
  server.tryShutdown(() => process.exit(0));
}
