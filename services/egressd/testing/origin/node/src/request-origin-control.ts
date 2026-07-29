export async function requestOriginControl<T>(
  endpoint: string,
  path: string,
  init?: {
    readonly method?: string;
    readonly body?: unknown;
  }
): Promise<T> {
  const response = await fetch(`${endpoint}${path}`, {
    method: init?.method ?? "GET",
    ...(init?.body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(init.body)
        }),
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) {
    throw new Error(
      `Controlled-origin control failed with ${String(response.status)}`);
  }
  return response.status === 204
    ? undefined as T
    : await response.json() as T;
}
