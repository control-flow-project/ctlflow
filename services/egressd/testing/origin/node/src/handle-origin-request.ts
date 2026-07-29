import type {
  IncomingMessage,
  ServerResponse
} from "node:http";
import {
  captureOriginRequest
} from "./capture-origin-request.js";
import type {
  OriginState
} from "./origin-state.js";

export async function handleOriginRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: OriginState
): Promise<void> {
  if (!state.available) {
    request.socket.destroy();
    return;
  }

  const evidence = await captureOriginRequest(request);
  state.evidence.push(evidence);
  response.once("close", () => {
    if (!response.writableEnded) {
      evidence.cancelled = true;
    }
  });
  const path = new URL(
    evidence.target,
    "https://controlled.invalid").pathname;
  switch (path) {
    case "/known-large":
      respond(response, 200, Buffer.alloc(64, 0x61), {
        "content-type": "application/octet-stream"
      });
      return;
    case "/stream-large":
      response.writeHead(200, {
        "content-type": "application/octet-stream"
      });
      response.write(Buffer.alloc(12, 0x61));
      await delay(20);
      response.end(Buffer.alloc(12, 0x62));
      return;
    case "/delay":
      await delay(3_000);
      respond(response, 200, Buffer.from("delayed"));
      return;
    case "/slow":
      await delay(10_000);
      if (!response.destroyed) {
        respond(response, 200, Buffer.from("slow"));
      }
      return;
    case "/cancel":
      await delay(5_000);
      if (!response.destroyed) {
        respond(response, 200, Buffer.from("late"));
      }
      return;
    case "/status":
      respond(response, 418, Buffer.from("ordinary status"), {
        "content-type": "text/plain",
        "x-upstream": "visible",
        "x-hidden": "hidden",
        "set-cookie": "provider=value; Secure"
      });
      return;
    case "/redirect":
      respond(response, 302, Buffer.alloc(0), {
        location: "https://elsewhere.invalid/escape"
      });
      return;
    case "/binary":
      respond(
        response,
        200,
        Buffer.from([0, 1, 2, 3, 254, 255]),
        { "content-type": "application/octet-stream" });
      return;
    case "/sse":
      response.writeHead(200, {
        "content-type": "text/event-stream"
      });
      response.write("data: one\n\n");
      await delay(20);
      response.end("data: two\n\n");
      return;
    default:
      respond(
        response,
        200,
        Buffer.from(JSON.stringify({
          method: evidence.method,
          target: evidence.target,
          bodyBase64: evidence.bodyBase64
        })),
        {
          "content-type": "application/json",
          "x-upstream": "visible",
          "x-hidden": "hidden"
        });
  }
}

function respond(
  response: ServerResponse,
  statusCode: number,
  body: Buffer,
  headers: Readonly<Record<string, string>> = {}
): void {
  response.writeHead(statusCode, {
    ...headers,
    "content-length": String(body.length)
  });
  response.end(body);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
