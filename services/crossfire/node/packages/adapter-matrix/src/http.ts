import { failure, success, type Result } from "@ctlflow/crossfire-kernel/result";
import { object } from "@ctlflow/crossfire-contracts/validation";
import type { Readable } from "node:stream";
import { Agent, fetch } from 'undici';
import { MAX_JSON_BYTES } from "@ctlflow/crossfire-contracts/limits";

import type { Json, JsonObject } from '@ctlflow/crossfire-contracts/json';
export type Native = { base: string; token?: string; signal?: AbortSignal; timeoutMs?: number };
export type NativeResponse = { status: number; body: JsonObject };
import { API, segment, json } from '@ctlflow/crossfire-contracts/matrix';
import { endpoint } from '@ctlflow/crossfire-contracts/origin';
import { markdownMessage } from './message.js';
import { roomState, type RoomStateEvent } from '@ctlflow/crossfire-contracts/matrix-room';
import { truncateUtf16 } from '@ctlflow/crossfire-kernel/text';

const dispatcher = new Agent({ allowH2: false });

export async function nativeOpen(client: Native, method: string, path: string, body?: Buffer | Readable,
  contentType = "application/json"): Promise<Result<Response>> {
  const origin = endpoint(client.base);
  if (!origin.ok) return origin;
  const timeout = client.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 45_000 || !["GET", "POST", "PUT", "DELETE"].includes(method)
    || !path.startsWith("/") || path.startsWith("//") || /[\\#\s\u0000-\u001f\u007f]/u.test(path) || path.length > 65_536) return failure("invalid", "Invalid bounded HTTP request");
  try {
    const destination = new URL(origin.value + path);
    if (destination.origin !== origin.value || destination.username || destination.password || destination.hash) {
      return failure("invalid", "HTTP request must remain on its configured origin");
    }
    const deadline = AbortSignal.timeout(timeout);
    return success(await fetch(destination, {
      method, redirect: "error", signal: client.signal ? AbortSignal.any([client.signal, deadline]) : deadline,
      dispatcher,
      headers: { "Content-Type": contentType, ...(client.token ? { Authorization: "Bearer " + client.token } : {}) },
      ...(body === undefined ? {} : { body, duplex: "half" as const }),
    }));
  } catch {
    return failure("native", "HTTP request failed or exceeded its deadline");
  }
}

export async function collect(source: AsyncIterable<Uint8Array>, maximum = MAX_JSON_BYTES): Promise<Buffer> {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("Invalid finite response byte limit");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > maximum) throw Object.assign(new Error("Response exceeds its finite byte limit"), { code: 'body_too_large' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function nativeJson(client: Native, method: string, path: string, body?: unknown, maximumBytes = MAX_JSON_BYTES): Promise<Result<{ status: number; body: Json }>> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 64 * 1024 * 1024) return failure('invalid', 'Invalid HTTP response resource bound');
  if (body !== undefined && !json(body)) return failure("invalid", "Invalid HTTP JSON request");
  const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  if (encoded && encoded.length > MAX_JSON_BYTES) return failure("limit", "HTTP request exceeds 1 MiB");
  const opened = await nativeOpen(client, method, path, encoded);
  if (!opened.ok) return opened;
  const response = opened.value;
  if (!response.body) return failure("native", "HTTP response has no body");
  try {
    const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await collect(response.body, maximumBytes)));
    if (!json(decoded)) return failure("native", "Invalid HTTP JSON response");
    return success({ status: response.status, body: decoded });
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'body_too_large'
      ? failure('body_too_large', 'HTTP response exceeds its collection resource bound')
      : failure("native", "HTTP response is invalid or exceeds its deadline");
  }
}

export function matrix(client: Native) {
  async function request<T = JsonObject>(method: string, path: string, body?: unknown, maximumBytes?: number): Promise<T> {
    const result = await nativeJson(client, method, path, body, maximumBytes);
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    if (result.value.status >= 300) {
      const content = object(result.value.body);
      const code = content.ok && typeof content.value.errcode === "string" ? truncateUtf16(content.value.errcode, 80) : "ERROR";
      throw Object.assign(new Error("Native HTTP " + result.value.status + ": " + code), { status: result.value.status });
    }
    return result.value.body as T;
  }
  async function open(method: string, path: string, body?: Buffer | Readable, contentType?: string): Promise<ReadableStream<Uint8Array>> {
    const result = await nativeOpen(client, method, path, body, contentType);
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    const response = result.value;
    if (!response.body) throw new Error("Native response has no body");
    if (response.status >= 300) {
      await collect(response.body, 65_536);
      throw Object.assign(new Error("Native HTTP " + response.status), { status: response.status });
    }
    return response.body;
  }
  function get<T = JsonObject>(path: string, query?: Record<string, string | number>, maximumBytes?: number): Promise<T> {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) parameters.set(key, String(value));
    return request<T>("GET", path + (parameters.size ? "?" + parameters.toString() : ""), undefined, maximumBytes);
  }
  return { request, open, get, message: markdownMessage,
    post: <T = JsonObject>(path: string, body: unknown) => request<T>("POST", path, body),
    put: <T = JsonObject>(path: string, body: unknown) => request<T>("PUT", path, body),
  };
}

export type Matrix = ReturnType<typeof matrix>;
export async function nativeRequest(client: Native, method: string, path: string, body?: unknown): Promise<Result<NativeResponse>> {
  const result = await nativeJson(client, method, path, body);
  if (!result.ok) return result;
  const parsed = object(result.value.body);
  return parsed.ok ? success({ status: result.value.status, body: result.value.body as JsonObject })
    : failure("native", "Expected a native JSON object");
}

export async function nativeState(client: Native, room: string): Promise<Result<RoomStateEvent[]>> {
  const result = await nativeJson(client, "GET", API + "/rooms/" + segment(room) + "/state");
  if (!result.ok) return result;
  return result.value.status === 200 ? roomState(result.value.body) : failure('native', 'Native room state could not be read');
}

export async function nativeOk(client: Native, method: string, path: string, body?: unknown): Promise<Result<JsonObject>> {
  const response = await nativeRequest(client, method, path, body);
  if (!response.ok) return response;
  if (response.value.status < 200 || response.value.status >= 300) {
    const code = response.value.body.errcode;
    return failure("native", "Native HTTP " + response.value.status + (typeof code === "string" ? ": " + truncateUtf16(code, 80) : ""));
  }
  return success(response.value.body);
}
