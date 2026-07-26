import {
  mkdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  runCommand
} from "../processes/run-command.js";
import type {
  TestOperatorCredentials
} from "./test-operator-credentials.js";

export async function createKubernetesOperatorCredentials(
  repositoryRoot: string,
  directory: string,
  certificateAuthorityPath: string,
  certificateAuthorityPrivateKey: string,
  subject: string
): Promise<TestOperatorCredentials> {
  if (!/^[a-zA-Z0-9._:-]{1,100}$/u.test(subject)) {
    throw new Error("Test operator subject is invalid");
  }

  await mkdir(directory, {
    recursive: true
  });
  const prefix = subject.replaceAll(":", "-");
  const certificateAuthorityKeyPath = path.join(
    directory,
    `${prefix}-ca.key`);
  const certificatePath = path.join(
    directory,
    `${prefix}.crt`);
  const privateKeyPath = path.join(
    directory,
    `${prefix}.key`);
  const requestPath = path.join(
    directory,
    `${prefix}.csr`);
  const extensionsPath = path.join(
    directory,
    `${prefix}.ext`);
  await writeFile(
    certificateAuthorityKeyPath,
    certificateAuthorityPrivateKey,
    { mode: 0o600 });
  await writeFile(
    extensionsPath,
    [
      "extendedKeyUsage=clientAuth",
      "keyUsage=digitalSignature",
      ""
    ].join("\n"),
    "utf8");
  await runCommand(
    "openssl",
    [
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      `/CN=${subject}`,
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

  return {
    subject,
    certificatePath,
    privateKeyPath
  };
}
