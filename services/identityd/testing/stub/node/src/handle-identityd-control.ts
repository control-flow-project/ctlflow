import type {
  IncomingMessage,
  ServerResponse
} from "node:http";
import type {
  IdentitydMode
} from "./identityd-mode.js";
import type {
  IdentitydSourceConfiguration
} from "./identityd-source-configuration.js";
import type {
  IdentitydStubState
} from "./identityd-stub-state.js";
import type {
  InvocationVerificationKeyResponse
} from "./invocation-verification-key.js";
import type {
  PrincipalAuthorizationFacts
} from "./principal-authorization-facts.js";

export async function handleIdentitydControl(
  state: IdentitydStubState,
  request: IncomingMessage,
  response: ServerResponse
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
    await createSource(
      state,
      request,
      response);
    return;
  }

  const sourceId = segments[1];
  if (
    segments[0] !== "sources"
    || sourceId === undefined
  ) {
    throw new Error("source was not found");
  }
  const source = state.sources.get(sourceId);
  if (source === undefined) {
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
    && segments[2] === "verification-keys"
  ) {
    source.verificationKeys =
      await readBody(request) as
        InvocationVerificationKeyResponse;
    sendJson(response, 204, undefined);
    return;
  }
  if (
    request.method === "PUT"
    && segments[2] === "principal-facts"
  ) {
    source.principalFacts =
      await readBody(request) as
        readonly PrincipalAuthorizationFacts[];
    sendJson(response, 204, undefined);
    return;
  }
  if (
    request.method === "DELETE"
    && segments.length === 2
  ) {
    state.sources.delete(sourceId);
    sendJson(response, 204, undefined);
    return;
  }

  throw new Error("control operation is invalid");
}

async function createSource(
  state: IdentitydStubState,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readBody(request) as
    IdentitydSourceConfiguration & {
      readonly sourceId: string;
    };
  if (
    state.sources.has(body.sourceId)
    || !isServiceAccountSubject(body.callerSubject)
    || [...state.sources.values()].some(
      (source) =>
        source.callerSubject === body.callerSubject)
  ) {
    throw new Error("source is invalid");
  }

  state.sources.set(body.sourceId, {
    callerSubject: body.callerSubject,
    mode: "available",
    verificationKeys: body.verificationKeys,
    principalFacts: body.principalFacts,
    requests: []
  });
  sendJson(response, 201, {});
}

async function readBody(
  request: IncomingMessage
): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(
    Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sendJson(
  response: ServerResponse,
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
