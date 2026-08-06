import {
  access
} from "node:fs/promises";
import {
  createServer
} from "node:http";
import {
  checkProductAccess,
  readBootstrapSummary,
  type ProductCheckRequest
} from "./product-authorization.js";

const maximumBodyBytes = 1_048_576;

const server = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = [];
    let bodyBytes = 0;
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk);
      bodyBytes += bytes.length;
      if (bodyBytes > maximumBodyBytes) {
        throw new Error("request body exceeds fixture bound");
      }
      chunks.push(bytes);
    }

    response.setHeader("content-type", "application/json");
    const requestPath = (request.url ?? "").split("?")[0];
    if (request.method === "POST"
        && requestPath === "/product-check") {
      const body = JSON.parse(
        Buffer.concat(chunks).toString("utf8")) as ProductCheckRequest;
      const traceParent = typeof request.headers.traceparent === "string"
        ? request.headers.traceparent
        : undefined;
      response.end(JSON.stringify(
        await checkProductAccess(body, traceParent)));
      return;
    }
    if (request.method === "GET" && requestPath === "/bootstrap") {
      response.end(JSON.stringify(readBootstrapSummary()));
      return;
    }

    response.end(JSON.stringify({
      method: request.method,
      target: request.url,
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
      body: Buffer.concat(chunks).toString("utf8"),
      edgedCredentialsMounted:
        await pathExists("/var/run/ctlflow/edged")
    }));
  } catch {
    response.statusCode = 500;
    response.end("controlled application failure\n");
  }
});

server.listen(8_080, "127.0.0.1");

async function pathExists(path: string): Promise<boolean> {
  return await access(path)
    .then(() => true)
    .catch(() => false);
}

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
