import http from "node:http";

export async function requestAuditdControl<T>(
  endpoint: string,
  path: string,
  options: {
    readonly method?: string;
    readonly body?: unknown;
  } = {}
): Promise<T> {
  const body = options.body === undefined
    ? undefined
    : Buffer.from(JSON.stringify(options.body));
  return await new Promise<T>((resolve, reject) => {
    const request = http.request(
      new URL(path, endpoint),
      {
        method: options.method ?? "GET",
        headers: body === undefined
          ? undefined
          : {
              "content-type": "application/json",
              "content-length": String(body.length)
            }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(
              `auditd control returned ${String(response.statusCode)}: ${text}`));
            return;
          }

          resolve(text.length === 0 ? undefined as T : JSON.parse(text) as T);
        });
      });
    request.once("error", reject);
    if (body !== undefined) {
      request.write(body);
    }
    request.end();
  });
}
