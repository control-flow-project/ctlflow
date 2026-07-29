import {
  copyFile,
  mkdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  randomUUID
} from "node:crypto";
import type {
  EgressdTestSuite
} from "../suite/egressd-test-suite.js";

export interface StartupFiles {
  readonly bindingPath: string;
  readonly secretsPath: string;
  readonly workloadJwksPath: string;
  readonly upstreamCertificateAuthorityPath: string;
}

export async function writeStartupFiles(
  suite: EgressdTestSuite,
  binding: string,
  secrets: string
): Promise<StartupFiles> {
  const directory = path.join(
    suite.repositoryRoot,
    ".temp/test-mesh/egressd/startup",
    randomUUID());
  await mkdir(directory, { recursive: true });
  const bindingPath = path.join(directory, "binding.json");
  const secretsPath = path.join(directory, "secrets.json");
  const workloadJwksPath = path.join(directory, "workload-jwks.json");
  const upstreamCertificateAuthorityPath =
    path.join(directory, "upstream-ca.crt");
  await writeFile(bindingPath, binding, "utf8");
  await writeFile(secretsPath, secrets, "utf8");
  await copyFile(suite.files.workloadJwksPath, workloadJwksPath);
  await copyFile(
    suite.files.upstreamCertificateAuthorityPath,
    upstreamCertificateAuthorityPath);
  return {
    bindingPath,
    secretsPath,
    workloadJwksPath,
    upstreamCertificateAuthorityPath
  };
}
