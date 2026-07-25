import {
  request as requestHttps
} from "node:https";
import type {
  IncomingHttpHeaders,
  OutgoingHttpHeaders
} from "node:http";
import { readFile } from "node:fs/promises";
import type {
  TenantdTestContext
} from "./create-tenantd-test-context.js";

export interface AggregationApiRequest {
  readonly method: "DELETE" | "GET" | "POST" | "PUT";
  readonly path: string;
  readonly operator?: string;
  readonly idempotencyKey?: string;
  readonly body?: Buffer;
  readonly contentType?: string;
  readonly chunked?: boolean;
  readonly clientIdentity?: "admitted" | "none" | "unadmitted";
}

export interface AggregationApiResponse {
  readonly statusCode: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
  readonly text: string;
}

const maximumResponseBytes = 1024 * 1024;
const serverName = "tenantd-aggregation.ctlflow-tests.svc";

export async function requestAggregationApi(
  context: TenantdTestContext,
  request: AggregationApiRequest
): Promise<AggregationApiResponse> {
  const credentials = context.aggregation;
  const identity = request.clientIdentity ?? "admitted";
  const [certificateAuthority, clientCertificate, clientKey] =
    await Promise.all([
      readFile(credentials.serverCertificateAuthorityPath),
      identity === "none"
        ? Promise.resolve(undefined)
        : readFile(
            identity === "admitted"
              ? credentials.requestHeaderClientCertificatePath
              : credentials.unadmittedClientCertificatePath),
      identity === "none"
        ? Promise.resolve(undefined)
        : readFile(
            identity === "admitted"
              ? credentials.requestHeaderClientKeyPath
              : credentials.unadmittedClientKeyPath)
    ]);
  const headers: OutgoingHttpHeaders = {
    accept: "application/json",
    ...(request.operator === undefined
      ? {}
      : { "x-remote-user": request.operator }),
    ...(request.idempotencyKey === undefined
      ? {}
      : { "idempotency-key": request.idempotencyKey }),
    ...(request.body === undefined
      ? {}
      : {
          "content-type": request.contentType ?? "application/json",
          ...(request.chunked === true
            ? {}
            : { "content-length": request.body.byteLength })
        })
  };

  return await new Promise<AggregationApiResponse>((resolve, reject) => {
    const outbound = requestHttps({
      hostname: "127.0.0.1",
      port: context.aggregationPort,
      servername: serverName,
      method: request.method,
      path: request.path,
      ca: certificateAuthority,
      cert: clientCertificate,
      key: clientKey,
      rejectUnauthorized: true,
      headers
    }, (response) => {
      const chunks: Buffer[] = [];
      let length = 0;
      response.on("data", (chunk: Buffer) => {
        length += chunk.byteLength;
        if (length > maximumResponseBytes) {
          outbound.destroy(new Error(
            "Aggregation response exceeds the test bound"));
          return;
        }

        chunks.push(chunk);
      });
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: parseBody(text),
          text
        });
      });
    });
    outbound.once("error", reject);
    outbound.setTimeout(5_000, () => {
      outbound.destroy(new Error("Aggregation request timed out"));
    });
    if (request.body !== undefined) {
      if (request.chunked === true && request.body.byteLength > 1) {
        const midpoint = Math.floor(request.body.byteLength / 2);
        outbound.write(request.body.subarray(0, midpoint));
        outbound.write(request.body.subarray(midpoint));
      } else {
        outbound.write(request.body);
      }
    }
    outbound.end();
  });
}

function parseBody(text: string): unknown {
  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
