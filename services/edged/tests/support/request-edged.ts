import http from "node:http";
import {
  getEdgedTestSuite
} from "../suite/get-edged-test-suite.js";

export interface EdgedHttpResponse {
  readonly statusCode: number;
  readonly headers: ReadonlyMap<string, readonly string[]>;
  readonly body: Buffer;
}

export interface EdgedRequestOptions {
  readonly method?: string;
  readonly path?: string;
  readonly headers?: readonly (readonly [string, string])[];
  readonly body?: string | Buffer;
  readonly signal?: AbortSignal;
  readonly probe?: boolean;
  readonly chunked?: boolean;
}

export async function requestEdged(
  options: EdgedRequestOptions = {}
): Promise<EdgedHttpResponse> {
  const suite = getEdgedTestSuite();
  const port = options.probe
    ? suite.edged.probePort
    : suite.edged.publicPort;
  const headers = (options.headers ?? [])
    .flatMap(([name, value]) => [name, value]);
  if (!hasHeader(headers, "host")) {
    headers.unshift("Host", "application.example.test");
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
  return await new Promise((resolve, reject) => {
    let settled = false;
    let responseStarted = false;
    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: options.path ?? "/",
        headers: headers.length === 0 ? undefined : headers,
        signal: options.signal
      },
      (response) => {
        responseStarted = true;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", fail);
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
    request.once("connect", (response, socket, head) => {
      const chunks: Buffer[] = head.length === 0 ? [] : [head];
      socket.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        const expected = Number(response.headers["content-length"] ?? NaN);
        if (Number.isSafeInteger(expected)
            && Buffer.concat(chunks).length >= expected) {
          if (!settled) {
            settled = true;
            socket.destroy();
            resolve({
              statusCode: response.statusCode ?? 0,
              headers: collectHeaders(response.rawHeaders),
              body: Buffer.concat(chunks).subarray(0, expected)
            });
          }
        }
      });
      socket.on("error", fail);
      socket.once("end", () => {
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
    request.on("error", (error) => {
      if (!responseStarted) {
        fail(error);
      }
    });
    if (options.chunked === true
        && options.body !== undefined) {
      void writeChunkedBody(
        request,
        Buffer.isBuffer(options.body)
          ? options.body
          : Buffer.from(options.body),
        () => responseStarted)
        .catch((error: Error) => {
          if (!responseStarted) {
            fail(error);
          }
        });
      return;
    }
    request.end(options.body);
  });
}

export function readHeader(
  response: EdgedHttpResponse,
  name: string
): string | undefined {
  const values = response.headers.get(name.toLowerCase());
  return values?.length === 1 ? values[0] : undefined;
}

export function readHeaders(
  response: EdgedHttpResponse,
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

function hasHeader(headers: readonly string[], expected: string): boolean {
  for (let index = 0; index < headers.length; index += 2) {
    if (headers[index]?.toLowerCase() === expected) {
      return true;
    }
  }
  return false;
}

async function writeChunkedBody(
  request: http.ClientRequest,
  body: Buffer,
  responseStarted: () => boolean
): Promise<void> {
  const blockBytes = 64 * 1024;
  for (let offset = 0; offset < body.length; offset += blockBytes) {
    if (responseStarted()) {
      return;
    }
    const block = body.subarray(
      offset,
      Math.min(offset + blockBytes, body.length));
    if (!request.write(block)) {
      await new Promise<void>((resolve, reject) => {
        const onDrain = () => {
          finish(resolve);
        };
        const onResponse = () => {
          finish(resolve);
        };
        const onError = (error: Error) => {
          finish(() => reject(error));
        };
        const finish = (complete: () => void) => {
          request.off("drain", onDrain);
          request.off("response", onResponse);
          request.off("error", onError);
          complete();
        };
        request.once("drain", onDrain);
        request.once("response", onResponse);
        request.once("error", onError);
      });
    }
  }
  if (!responseStarted()) {
    request.end();
  }
}
