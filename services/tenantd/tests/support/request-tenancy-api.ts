import {
  request as requestHttps
} from "node:https";
import type {
  IncomingHttpHeaders
} from "node:http";
import type {
  TestKubernetesApiCredentials
} from "@ctlflow/test-mesh";
import {
  createTenancyApiRequestOptions
} from "./create-tenancy-api-request-options.js";

export interface TenancyApiRequest {
  readonly method: "DELETE" | "GET" | "POST" | "PUT";
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface TenancyApiResponse {
  readonly statusCode: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
  readonly text: string;
}

const maximumResponseBytes = 1024 * 1024;

export async function requestTenancyApi(
  credentials: TestKubernetesApiCredentials,
  request: TenancyApiRequest
): Promise<TenancyApiResponse> {
  const encodedBody = request.body === undefined
    ? undefined
    : Buffer.from(JSON.stringify(request.body), "utf8");
  const options = await createTenancyApiRequestOptions(credentials, {
    method: request.method,
    path: request.path,
    headers: {
      accept: "application/json",
      ...(
        encodedBody === undefined
          ? {}
          : {
              "content-type": "application/json",
              "content-length": String(encodedBody.byteLength)
            }
      ),
      ...request.headers
    }
  });

  return await new Promise<TenancyApiResponse>((resolve, reject) => {
    const outbound = requestHttps(options, (response) => {
      const chunks: Buffer[] = [];
      let length = 0;

      response.on("data", (chunk: Buffer) => {
        length += chunk.byteLength;
        if (length > maximumResponseBytes) {
          outbound.destroy(new Error(
            "Kubernetes API response exceeds the test bound"));
          return;
        }

        chunks.push(chunk);
      });
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body: unknown = undefined;
        if (text.length > 0) {
          try {
            body = JSON.parse(text) as unknown;
          } catch {
            body = text;
          }
        }

        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body,
          text
        });
      });
    });
    outbound.on("error", reject);
    if (encodedBody !== undefined) {
      outbound.write(encodedBody);
    }
    outbound.end();
  });
}
