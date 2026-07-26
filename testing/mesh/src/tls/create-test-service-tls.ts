import {
  chmod,
  mkdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../processes/run-command.js";
import type { TestServiceTls } from "./test-service-tls.js";

export async function createTestServiceTls(
  repositoryRoot: string,
  directory: string,
  name: string,
  dnsNames: readonly string[]
): Promise<TestServiceTls> {
  if (!/^[a-z0-9-]+$/u.test(name)
      || dnsNames.length < 1
      || dnsNames.some((value) =>
        !/^[a-z0-9.-]+$/u.test(value))) {
    throw new Error("Test TLS identity is invalid");
  }

  await mkdir(directory, { recursive: true });
  const certificateAuthorityPath = path.join(
    directory,
    `${name}-ca.crt`);
  const certificateAuthorityKeyPath = path.join(
    directory,
    `${name}-ca.key`);
  const certificatePath = path.join(directory, `${name}.crt`);
  const privateKeyPath = path.join(directory, `${name}.key`);
  const requestPath = path.join(directory, `${name}.csr`);
  const extensionsPath = path.join(directory, `${name}.ext`);
  await writeFile(
    extensionsPath,
    [
      `subjectAltName=${dnsNames.map((value) => `DNS:${value}`).join(",")}`,
      "extendedKeyUsage=serverAuth",
      "keyUsage=digitalSignature,keyEncipherment",
      ""
    ].join("\n"),
    "utf8");

  await runCommand(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "2",
      "-subj",
      `/CN=${name}-test-ca`,
      "-keyout",
      certificateAuthorityKeyPath,
      "-out",
      certificateAuthorityPath
    ],
    { cwd: repositoryRoot });
  await runCommand(
    "openssl",
    [
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      `/CN=${dnsNames[0]!}`,
      "-keyout",
      privateKeyPath,
      "-out",
      requestPath
    ],
    { cwd: repositoryRoot });
  await runCommand(
    "openssl",
    [
      "x509",
      "-req",
      "-days",
      "2",
      "-in",
      requestPath,
      "-CA",
      certificateAuthorityPath,
      "-CAkey",
      certificateAuthorityKeyPath,
      "-CAcreateserial",
      "-extfile",
      extensionsPath,
      "-out",
      certificatePath
    ],
    { cwd: repositoryRoot });
  await chmod(privateKeyPath, 0o644);

  return {
    certificateAuthorityPath,
    certificatePath,
    privateKeyPath,
    serverName: dnsNames[0]!
  };
}
