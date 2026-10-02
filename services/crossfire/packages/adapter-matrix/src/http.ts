import { failure, success, type Result } from "@crossfire/kernel/result";
import { object } from "@crossfire/contracts/validation";
import type { Readable } from "node:stream";
import { MAX_JSON_BYTES } from "@crossfire/contracts/limits";

import type { Json, JsonObject } from '@crossfire/contracts/json';
export type Native = { base: string; token?: string; signal?: AbortSignal; timeoutMs?: number };
export type NativeResponse = { status: number; body: JsonObject };
import { API, segment, json } from '@crossfire/contracts/matrix';
import { endpoint } from '@crossfire/contracts/origin';
import { markdownMessage } from './message.js';
import { roomState, type RoomStateEvent } from '@crossfire/contracts/matrix-room';

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
    if (size > maximum) throw new Error("Response exceeds its finite byte limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function nativeJson(client: Native, method: string, path: string, body?: unknown): Promise<Result<{ status: number; body: Json }>> {
  if (body !== undefined && !json(body)) return failure("invalid", "Invalid HTTP JSON request");
  const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  if (encoded && encoded.length > MAX_JSON_BYTES) return failure("limit", "HTTP request exceeds 1 MiB");
  const opened = await nativeOpen(client, method, path, encoded);
  if (!opened.ok) return opened;
  const response = opened.value;
  if (!response.body) return failure("native", "HTTP response has no body");
  try {
    const decoded: unknown = JSON.parse((await collect(response.body)).toString("utf8"));
    if (!json(decoded)) return failure("native", "Invalid HTTP JSON response");
    return success({ status: response.status, body: decoded });
  } catch {
    return failure("native", "HTTP response is invalid or exceeds its deadline/size bound");
  }
}

export function matrix(client: Native) {
  async function request<T = JsonObject>(method: string, path: string, body?: unknown): Promise<T> {
    const result = await nativeJson(client, method, path, body);
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    if (result.value.status >= 300) {
      const content = object(result.value.body);
      const code = content.ok && typeof content.value.errcode === "string" ? content.value.errcode.slice(0, 80) : "ERROR";
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
  function get<T = JsonObject>(path: string, query?: Record<string, string | number>): Promise<T> {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) parameters.set(key, String(value));
    return request<T>("GET", path + (parameters.size ? "?" + parameters.toString() : ""));
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
    return failure("native", "Native HTTP " + response.value.status + (typeof code === "string" ? ": " + code.slice(0, 80) : ""));
  }
  return success(response.value.body);
}
