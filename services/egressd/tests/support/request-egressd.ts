import http from "node:http";
import {
  getEgressdTestSuite
} from "../suite/get-egressd-test-suite.js";

export interface EgressdHttpResponse {
  readonly statusCode: number;
  readonly headers: ReadonlyMap<string, readonly string[]>;
  readonly body: Buffer;
}

export interface EgressdRequestOptions {
  readonly method?: string;
  readonly path?: string;
  readonly headers?: readonly (readonly [string, string])[];
  readonly body?: string | Buffer;
  readonly signal?: AbortSignal;
  readonly probe?: boolean;
  readonly chunked?: boolean;
  readonly authenticate?: boolean;
}

export async function requestEgressd(
  options: EgressdRequestOptions = {}
): Promise<EgressdHttpResponse> {
  const suite = getEgressdTestSuite();
  const port = options.probe
    ? suite.egressd.probePort
    : suite.egressd.publicPort;
  const headers = [...(options.headers ?? [])]
    .flatMap(([name, value]) => [name, value]);
  if (!hasHeader(headers, "host")) {
    headers.unshift("Host", "egressd.internal");
  }
  if (options.authenticate !== false
      && !options.probe
      && !hasHeader(headers, "proxy-authorization")) {
    headers.push(
      "Proxy-Authorization",
      `Bearer ${suite.caller.callerToken}`);
  }
  if (options.chunked === true
      && !hasHeader(headers, "transfer-encoding")) {
    headers.push("Transfer-Encoding", "chunked");
  }
  if (options.body !== undefined
      && options.chunked !== true
      && !hasHeader(headers, "content-length")
      && !hasHeader(headers, "transfer-encoding")) {
    headers.push(
      "Content-Length",
      String(Buffer.byteLength(options.body)));
  }
  return await send(port, headers, options);
}

export function readHeader(
  response: EgressdHttpResponse,
  name: string
): string | undefined {
  const values = response.headers.get(name.toLowerCase());
  return values?.length === 1 ? values[0] : undefined;
}

async function send(
  port: number,
  headers: readonly string[],
  options: EgressdRequestOptions
): Promise<EgressdHttpResponse> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: options.path ?? "/",
        headers,
        signal: options.signal
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("error", reject);
        response.once("aborted", () => {
          reject(new Error("Egressd response was aborted"));
        });
        response.once("end", () => {
          if (!settled) {
            settled = true;
            resolve({
              statusCode: response.statusCode ?? 0,
              headers: collectHeaders(response.rawHeaders),
              body: Buffer.concat(chunks)
            });
          }
        });
      });
    request.once("error", reject);
    if (options.chunked === true && options.body !== undefined) {
      const body = Buffer.isBuffer(options.body)
        ? options.body
        : Buffer.from(options.body);
      const midpoint = Math.ceil(body.length / 2);
      request.write(body.subarray(0, midpoint));
      setTimeout(() => {
        request.end(body.subarray(midpoint));
      }, 10).unref();
    } else {
      request.end(options.body);
    }
  });
}

function collectHeaders(
  raw: readonly string[]
): ReadonlyMap<string, readonly string[]> {
  const headers = new Map<string, string[]>();
  for (let index = 0; index < raw.length; index += 2) {
    const name = raw[index]?.toLowerCase();
    const value = raw[index + 1];
    if (name === undefined || value === undefined) {
      throw new Error("HTTP response contains malformed raw headers");
    }
    const values = headers.get(name) ?? [];
    values.push(value);
    headers.set(name, values);
  }
  return headers;
}

function hasHeader(headers: readonly string[], expected: string): boolean {
  for (let index = 0; index < headers.length; index += 2) {
    if (headers[index]?.toLowerCase() === expected) {
      return true;
    }
  }
  return false;
}
