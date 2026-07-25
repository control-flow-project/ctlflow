export async function requestAuditdControl<T>(
  endpoint: string,
  path: string,
  options: {
    readonly method?: string;
    readonly body?: unknown;
  } = {}
): Promise<T> {
  const response = await fetch(`${endpoint}${path}`, {
    method: options.method ?? "GET",
    ...(options.body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(options.body)
        }),
    signal: AbortSignal.timeout(2_000)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `auditd control ${options.method ?? "GET"} ${path} failed `
      + `with ${String(response.status)}: ${text}`);
  }

  return text.length === 0
    ? undefined as T
    : JSON.parse(text) as T;
}
