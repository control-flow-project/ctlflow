import type {
  IncomingMessage,
  ServerResponse
} from "node:http";
import type {
  OriginState
} from "./origin-state.js";
import {
  readBody
} from "./read-body.js";

export async function handleOriginControl(
  request: IncomingMessage,
  response: ServerResponse,
  state: OriginState
): Promise<void> {
  if (request.method === "GET" && request.url === "/readyz") {
    respond(response, 204);
    return;
  }
  if (request.method === "GET" && request.url === "/evidence") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(state.evidence));
    return;
  }
  if (request.method === "DELETE" && request.url === "/evidence") {
    state.evidence.length = 0;
    respond(response, 204);
    return;
  }
  if (request.method === "PUT" && request.url === "/availability") {
    const document = JSON.parse(
      (await readBody(request, 1_024)).toString("utf8")) as {
        readonly available?: unknown;
      };
    if (typeof document.available !== "boolean") {
      throw new Error("Controlled-origin availability is invalid");
    }
    state.available = document.available;
    respond(response, 204);
    return;
  }
  respond(response, 404);
}

function respond(response: ServerResponse, statusCode: number): void {
  response.writeHead(statusCode);
  response.end();
}
