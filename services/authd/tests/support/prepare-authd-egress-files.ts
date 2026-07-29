import {
  copyFile,
  mkdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type {
  ControlledOidcProvider
} from "@ctlflow/authd/testing/provider";
import type {
  StatelessServiceFiles,
  TestKubernetes,
  TestWorkloadCredentials
} from "@ctlflow/test-mesh";

export async function prepareAuthdEgressFiles(
  kubernetes: TestKubernetes,
  workload: TestWorkloadCredentials,
  provider: ControlledOidcProvider
): Promise<StatelessServiceFiles> {
  const directory = path.join(
    kubernetes.storage.hostRoot,
    "authd",
    "egress");
  await mkdir(directory, { recursive: true });
  const bindingPath = path.join(directory, "binding.json");
  const secretsPath = path.join(directory, "secrets.json");
  const workloadJwksPath = path.join(
    directory,
    "workload-jwks.json");
  const upstreamAuthorityPath = path.join(
    directory,
    "upstream-ca.crt");
  const tokenEndpoint = parseProviderEndpoint(
    provider.tokenEndpoint,
    "token");
  const userInfoEndpoint = parseProviderEndpoint(
    provider.userInfoEndpoint,
    "userinfo");
  if (tokenEndpoint.origin !== userInfoEndpoint.origin
      || tokenEndpoint.pathname === userInfoEndpoint.pathname) {
    throw new Error("OIDC provider endpoints are incompatible");
  }

  await writeFile(
    bindingPath,
    `${JSON.stringify({
      schema_version: 1,
      binding_id: "authd_oidc",
      caller: {
        namespace: kubernetes.namespace,
        service_account: "authd"
      },
      origin: tokenEndpoint.origin,
      rules: [
        createRule(
          "token",
          "POST",
          tokenEndpoint.pathname,
          [
            "accept",
            "authorization",
            "content-type"
          ],
          8 * 1024),
        createRule(
          "userinfo",
          "GET",
          userInfoEndpoint.pathname,
          ["accept", "authorization"],
          1)
      ]
    }, null, 2)}\n`,
    { mode: 0o644 });
  await writeFile(
    secretsPath,
    `${JSON.stringify({
      schema_version: 1,
      values: []
    }, null, 2)}\n`,
    { mode: 0o600 });
  await copyFile(workload.jwksPath, workloadJwksPath);
  await copyFile(
    provider.certificateAuthorityPath,
    upstreamAuthorityPath);
  return {
    config: { "binding.json": bindingPath },
    secret: { "secrets.json": secretsPath },
    trust: {
      "workload-jwks.json": workloadJwksPath,
      "upstream-ca.crt": upstreamAuthorityPath
    }
  };
}

function createRule(
  ruleId: string,
  method: "GET" | "POST",
  pathname: string,
  requestHeaders: readonly string[],
  maximumRequestBodyBytes: number
): object {
  return {
    rule_id: ruleId,
    methods: [method],
    match: {
      kind: "exact",
      path: pathname
    },
    upstream_path_prefix: pathname,
    forward_request_headers: requestHeaders,
    forward_response_headers: ["content-type"],
    set_request_headers: [],
    maximum_request_body_bytes: maximumRequestBodyBytes,
    maximum_response_body_bytes: 256 * 1024,
    forward_trace_context: false
  };
}

function parseProviderEndpoint(value: string, name: string): URL {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "https:"
      || endpoint.username.length !== 0
      || endpoint.password.length !== 0
      || endpoint.search.length !== 0
      || endpoint.hash.length !== 0
      || endpoint.pathname === "/") {
    throw new Error(`OIDC ${name} endpoint is invalid`);
  }
  return endpoint;
}
