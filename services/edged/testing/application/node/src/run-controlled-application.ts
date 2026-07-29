import {
  createHash
} from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";
import {
  setTimeout as delay
} from "node:timers/promises";

const maximumRequestBytes = 65 * 1024 * 1024;
let abortedRequests = 0;

const server = createServer(async (request, response) => {
  let aborted = false;
  const recordAbort = () => {
    if (!aborted) {
      aborted = true;
      abortedRequests++;
    }
  };
  request.on("aborted", recordAbort);
  response.on("close", () => {
    if (!response.writableEnded) {
      recordAbort();
    }
  });
  try {
    await handleRequest(request, response);
  } catch {
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end("fixture failure\n");
    } else {
      response.destroy();
    }
  }
});

server.on("clientError", (error, socket) => {
  const code = "code" in error
    ? String(error.code)
    : "unknown";
  process.stderr.write(
    `controlled application parser error: ${code} ${error.message}\n`);
  const body = `fixture parser error: ${code}\n`;
  socket.end(
    "HTTP/1.1 400 Bad Request\r\n"
    + "Connection: close\r\n"
    + "Content-Type: text/plain\r\n"
    + `Content-Length: ${String(Buffer.byteLength(body))}\r\n`
    + "\r\n"
    + body);
});

server.listen(18_080, "127.0.0.1");

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const target = new URL(
    request.url ?? "/",
    "http://application.test");
  if (target.pathname === "/delay") {
    await delay(readInteger(target, "milliseconds", 0, 60_000));
  }
  if (target.pathname === "/hold") {
    await delay(readInteger(target, "milliseconds", 0, 10_000));
  }
  if (target.pathname === "/stream") {
    await writeStream(
      response,
      readInteger(target, "bytes", 0, 65 * 1024 * 1024));
    return;
  }
  if (target.pathname === "/chunked-stream") {
    await writeChunkedStream(
      response,
      readInteger(target, "bytes", 0, 65 * 1024 * 1024));
    return;
  }
  if (target.pathname === "/events") {
    await writeEvents(response);
    return;
  }
  if (target.pathname === "/close") {
    response.destroy();
    return;
  }
  if (target.pathname === "/response-headers") {
    response.setHeader("x-application-header", "retained");
    response.setHeader(
      "set-cookie",
      [
        "application=value; Path=/; HttpOnly",
        "__Host-ctlflow-session=forged; Path=/; Secure"
      ]);
    response.setHeader("connection", "x-hop-response");
    response.setHeader("x-hop-response", "removed");
  }
  if (target.pathname === "/status") {
    response.statusCode = readInteger(target, "code", 100, 599);
  }

  const evidence = await readEvidence(request);
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({
    ...evidence,
    abortedRequests
  }));
}

async function readEvidence(
  request: IncomingMessage
): Promise<{
  readonly method: string;
  readonly target: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly bodyBytes: number;
  readonly bodySha256: string;
}> {
  const hash = createHash("sha256");
  let bodyBytes = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk);
    bodyBytes += bytes.length;
    if (bodyBytes > maximumRequestBytes) {
      throw new Error("fixture request body exceeded limit");
    }
    hash.update(bytes);
  }
  return {
    method: request.method ?? "",
    target: request.url ?? "",
    headers: request.headers,
    bodyBytes,
    bodySha256: hash.digest("hex")
  };
}

async function writeStream(
  response: ServerResponse,
  bytes: number
): Promise<void> {
  response.setHeader("content-type", "application/octet-stream");
  response.setHeader("content-length", String(bytes));
  await writeBlocks(response, bytes);
}

async function writeChunkedStream(
  response: ServerResponse,
  bytes: number
): Promise<void> {
  response.setHeader("content-type", "application/octet-stream");
  await writeBlocks(response, bytes);
}

async function writeBlocks(
  response: ServerResponse,
  bytes: number
): Promise<void> {
  const block = Buffer.alloc(Math.min(64 * 1024, bytes), 0x61);
  let written = 0;
  while (written < bytes) {
    const length = Math.min(block.length, bytes - written);
    if (!response.write(block.subarray(0, length))) {
      await new Promise<void>((resolve) =>
        response.once("drain", resolve));
    }
    written += length;
  }
  response.end();
}

async function writeEvents(response: ServerResponse): Promise<void> {
  response.setHeader("content-type", "text/event-stream");
  response.setHeader("cache-control", "no-cache");
  response.write("event: first\ndata: one\n\n");
  await delay(100);
  response.write("event: second\ndata: two\n\n");
  await delay(100);
  response.end("event: final\ndata: three\n\n");
}

function readInteger(
  target: URL,
  name: string,
  minimum: number,
  maximum: number
): number {
  const value = target.searchParams.get(name);
  const parsed = value === null ? NaN : Number(value);
  if (!Number.isSafeInteger(parsed)
      || parsed < minimum
      || parsed > maximum) {
    throw new Error(`invalid ${name}`);
  }
  return parsed;
}

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
