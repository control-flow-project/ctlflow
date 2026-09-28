import assert from "node:assert/strict";

export function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), "Expected a native JSON object");
  return value as Record<string, unknown>;
}

export function string(value: unknown): string {
  assert.equal(typeof value, "string", "Expected a native string");
  return value as string;
}

export async function request(base: string, method: string, path: string, body?: unknown, token?: string) {
  const endpoint = new URL(path, base);
  assert.equal(endpoint.protocol, "http:");
  assert.equal(endpoint.hostname, "127.0.0.1", "Architecture proofs must use an isolated loopback fixture");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== undefined) headers.Authorization = "Bearer " + token;
  const response = await fetch(endpoint, {
    method, headers, redirect: "error", signal: AbortSignal.timeout(15_000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert(response.body, "Native response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      assert(size <= 1024 * 1024, "Native fixture response exceeds 1 MiB");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return { status: response.status, body: object(value) };
}
