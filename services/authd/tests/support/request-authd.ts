import http from "node:http";
import {
  getAuthdTestSuite
} from "../suite/get-authd-test-suite.js";

export interface AuthdHttpResponse {
  readonly statusCode: number;
  readonly headers: ReadonlyMap<string, readonly string[]>;
  readonly body: string;
}

export interface AuthdRequestOptions {
  readonly method: string;
  readonly path: string;
  readonly headers?: readonly (readonly [string, string])[];
  readonly body?: string | Buffer;
  readonly signal?: AbortSignal;
  readonly probe?: boolean;
  readonly bodyDelayMilliseconds?: number;
}

export async function requestAuthd(
  options: AuthdRequestOptions
): Promise<AuthdHttpResponse> {
  const suite = getAuthdTestSuite();
  const port = options.probe
    ? suite.authd.probePort
    : suite.authd.publicPort;
  const headers = (options.headers ?? [])
    .flatMap(([name, value]) => [name, value]);
  return await new Promise((resolve, reject) => {
    let bodyTimer: NodeJS.Timeout | undefined;
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method: options.method,
        path: options.path,
        headers,
        signal: options.signal
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("error", reject);
        response.once("end", () => {
          if (bodyTimer !== undefined) {
            clearTimeout(bodyTimer);
            bodyTimer = undefined;
            request.destroy();
          }
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: collectHeaders(response.rawHeaders),
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      });
    request.once("error", (error) => {
      if (bodyTimer !== undefined) {
        clearTimeout(bodyTimer);
        bodyTimer = undefined;
      }
      reject(error);
    });
    if (options.bodyDelayMilliseconds === undefined) {
      request.end(options.body);
      return;
    }
    request.flushHeaders();
    bodyTimer = setTimeout(() => {
      bodyTimer = undefined;
      request.end(options.body);
    }, options.bodyDelayMilliseconds);
  });
}

export function readHeader(
  response: AuthdHttpResponse,
  name: string
): string | undefined {
  const values = response.headers.get(name.toLowerCase());
  return values?.length === 1 ? values[0] : undefined;
}

export function readHeaders(
  response: AuthdHttpResponse,
  name: string
): readonly string[] {
  return response.headers.get(name.toLowerCase()) ?? [];
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
