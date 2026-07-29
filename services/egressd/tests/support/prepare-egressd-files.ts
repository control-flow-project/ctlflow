import {
  copyFile,
  mkdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type {
  ControlledOrigin
} from "@ctlflow/egressd/testing/origin";
import type {
  TestKubernetes,
  TestWorkloadCredentials
} from "@ctlflow/test-mesh";
import {
  createBindingDocument
} from "./create-binding-document.js";

export interface EgressdTestFiles {
  readonly bindingPath: string;
  readonly secretsPath: string;
  readonly workloadJwksPath: string;
  readonly upstreamCertificateAuthorityPath: string;
}

export async function prepareEgressdFiles(
  repositoryRoot: string,
  kubernetes: TestKubernetes,
  caller: TestWorkloadCredentials,
  callerServiceAccount: string,
  origin: ControlledOrigin
): Promise<EgressdTestFiles> {
  const directory = path.join(
    repositoryRoot,
    ".temp/test-mesh/egressd",
    kubernetes.namespace);
  await mkdir(directory, { recursive: true });
  const bindingPath = path.join(directory, "binding.json");
  const secretsPath = path.join(directory, "secrets.json");
  const workloadJwksPath = path.join(directory, "workload-jwks.json");
  const upstreamCertificateAuthorityPath =
    path.join(directory, "upstream-ca.crt");
  await writeFile(
    bindingPath,
    `${JSON.stringify(createBindingDocument(
      origin.endpoint,
      kubernetes.namespace,
      callerServiceAccount), null, 2)}\n`,
    "utf8");
  await writeFile(
    secretsPath,
    `${JSON.stringify({
      schema_version: 1,
      values: [{
        name: "provider-key",
        value: "test-secret-material"
      }]
    }, null, 2)}\n`,
    "utf8");
  await copyFile(caller.jwksPath, workloadJwksPath);
  await copyFile(
    origin.certificateAuthorityPath,
    upstreamCertificateAuthorityPath);
  return {
    bindingPath,
    secretsPath,
    workloadJwksPath,
    upstreamCertificateAuthorityPath
  };
}
