export interface PolicyControlRequestOptions {
  readonly method?: "GET" | "POST" | "PUT" | "DELETE";
  readonly body?: unknown;
}

export async function requestPolicyControl<T>(
  endpoint: string,
  path: string,
  options: PolicyControlRequestOptions = {}
): Promise<T> {
  const response = await fetch(
    new URL(path, endpoint),
    {
      method: options.method ?? "GET",
      ...(options.body === undefined
        ? {}
        : {
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify(options.body)
          })
    });
  if (!response.ok) {
    throw new Error(
      `Policy control request failed with ${String(
        response.status)}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return await response.json() as T;
}
