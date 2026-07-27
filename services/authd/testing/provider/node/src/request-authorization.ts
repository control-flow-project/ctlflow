import {
  readFile
} from "node:fs/promises";
import https from "node:https";
import type {
  AuthorizationResult
} from "./controlled-oidc-provider.js";

export async function requestAuthorization(
  localEndpoint: string,
  location: string,
  expectedOrigin: string,
  serverName: string,
  certificateAuthorityPath: string
): Promise<AuthorizationResult> {
  const expected = new URL(expectedOrigin);
  const authorization = new URL(location);
  if (authorization.origin !== expected.origin) {
    throw new Error("Authorization location targets another provider");
  }
  const local = new URL(localEndpoint);
  local.pathname = authorization.pathname;
  local.search = authorization.search;
  const authority = await readFile(certificateAuthorityPath);
  return await new Promise((resolve, reject) => {
    const request = https.request(
      local,
      {
        method: "GET",
        ca: authority,
        servername: serverName,
        headers: { host: expected.host }
      },
      (response) => {
        response.resume();
        const result = {
          statusCode: response.statusCode ?? 0,
          location: response.headers.location ?? ""
        };
        response.once("end", () => resolve(result));
      });
    request.once("error", reject);
    request.setTimeout(5_000, () =>
      request.destroy(new Error("authorization deadline")));
    request.end();
  });
}
