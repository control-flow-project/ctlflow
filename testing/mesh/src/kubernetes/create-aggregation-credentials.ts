import {
  createPrivateKey,
  X509Certificate
} from "node:crypto";
import {
  readFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type {
  TestAggregationCredentials
} from "./test-kubernetes.js";
import { runCommand } from "../processes/run-command.js";

const serviceDnsName =
  "tenantd-aggregation.ctlflow-tests.svc";

export async function createAggregationCredentials(
  repositoryRoot: string,
  controlPlane: string,
  directory: string
): Promise<TestAggregationCredentials> {
  const requestHeaderCertificateAuthorityPath = path.join(
    directory,
    "request-header-ca.crt");
  const requestHeaderCertificateAuthorityKeyPath = path.join(
    directory,
    "request-header-ca.key");
  const requestHeaderClientCertificatePath = path.join(
    directory,
    "request-header-client.crt");
  const requestHeaderClientKeyPath = path.join(
    directory,
    "request-header-client.key");
  const requestHeaderCertificateAuthority = (await runCommand(
    "docker",
    [
      "exec",
      controlPlane,
      "cat",
      "/etc/kubernetes/pki/front-proxy-ca.crt"
    ],
    { cwd: repositoryRoot })).stdout;
  const requestHeaderClientCertificate = (await runCommand(
    "docker",
    [
      "exec",
      controlPlane,
      "cat",
      "/etc/kubernetes/pki/front-proxy-client.crt"
    ],
    { cwd: repositoryRoot })).stdout;
  const requestHeaderCertificateAuthorityKey = (await runCommand(
    "docker",
    [
      "exec",
      controlPlane,
      "cat",
      "/etc/kubernetes/pki/front-proxy-ca.key"
    ],
    { cwd: repositoryRoot })).stdout;
  const requestHeaderClientKey = (await runCommand(
    "docker",
    [
      "exec",
      controlPlane,
      "cat",
      "/etc/kubernetes/pki/front-proxy-client.key"
    ],
    { cwd: repositoryRoot })).stdout;
  await Promise.all([
    writeFile(
      requestHeaderCertificateAuthorityPath,
      requestHeaderCertificateAuthority,
      "utf8"),
    writeFile(
      requestHeaderCertificateAuthorityKeyPath,
      requestHeaderCertificateAuthorityKey,
      { encoding: "utf8", mode: 0o600 }),
    writeFile(
      requestHeaderClientCertificatePath,
      requestHeaderClientCertificate,
      "utf8"),
    writeFile(
      requestHeaderClientKeyPath,
      requestHeaderClientKey,
      { encoding: "utf8", mode: 0o600 })
  ]);
  const unadmitted = await createUnadmittedClientCertificate(
    repositoryRoot,
    directory,
    requestHeaderCertificateAuthorityPath,
    requestHeaderCertificateAuthorityKeyPath);

  const serverCertificateAuthorityPath = path.join(
    directory,
    "aggregation-server-ca.crt");
  const serverCertificateAuthorityKeyPath = path.join(
    directory,
    "aggregation-server-ca.key");
  const serverCertificatePath = path.join(
    directory,
    "aggregation-server.crt");
  const serverKeyPath = path.join(
    directory,
    "aggregation-server.key");
  const serverRequestPath = path.join(
    directory,
    "aggregation-server.csr");
  const serverExtensionsPath = path.join(
    directory,
    "aggregation-server.ext");
  await writeFile(
    serverExtensionsPath,
    [
      `subjectAltName=DNS:${serviceDnsName},DNS:${serviceDnsName}.cluster.local`,
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
      "/CN=ctlflow-test-aggregation-ca",
      "-keyout",
      serverCertificateAuthorityKeyPath,
      "-out",
      serverCertificateAuthorityPath
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
      `/CN=${serviceDnsName}`,
      "-keyout",
      serverKeyPath,
      "-out",
      serverRequestPath
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
      serverRequestPath,
      "-CA",
      serverCertificateAuthorityPath,
      "-CAkey",
      serverCertificateAuthorityKeyPath,
      "-CAcreateserial",
      "-extfile",
      serverExtensionsPath,
      "-out",
      serverCertificatePath
    ],
    { cwd: repositoryRoot });
  const generatedCertificate = new X509Certificate(
    await readFile(serverCertificatePath));
  const generatedPrivateKey = createPrivateKey(
    await readFile(serverKeyPath));
  if (!generatedCertificate.checkPrivateKey(generatedPrivateKey)) {
    throw new Error(
      "Generated aggregation certificate does not match its private key");
  }

  return {
    serverCertificateAuthorityPath,
    serverCertificatePath,
    serverKeyPath,
    requestHeaderCertificateAuthorityPath,
    requestHeaderClientCertificatePath,
    requestHeaderClientKeyPath,
    unadmittedClientCertificatePath:
      unadmitted.certificatePath,
    unadmittedClientKeyPath: unadmitted.keyPath,
    allowedClientName: readCommonName(requestHeaderClientCertificate)
  };
}

async function createUnadmittedClientCertificate(
  repositoryRoot: string,
  directory: string,
  certificateAuthorityPath: string,
  certificateAuthorityKeyPath: string
): Promise<{
  readonly certificatePath: string;
  readonly keyPath: string;
}> {
  const certificatePath = path.join(
    directory,
    "unadmitted-aggregation-client.crt");
  const keyPath = path.join(
    directory,
    "unadmitted-aggregation-client.key");
  const requestPath = path.join(
    directory,
    "unadmitted-aggregation-client.csr");
  const extensionsPath = path.join(
    directory,
    "unadmitted-aggregation-client.ext");
  await writeFile(
    extensionsPath,
    [
      "extendedKeyUsage=clientAuth",
      "keyUsage=digitalSignature,keyEncipherment",
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
      "/CN=unadmitted-aggregation-client",
      "-keyout",
      keyPath,
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
  return { certificatePath, keyPath };
}

function readCommonName(certificate: string): string {
  const subject = new X509Certificate(certificate).subject;
  const commonName = /^CN=(.+)$/mu.exec(subject)?.[1];
  if (commonName === undefined || commonName.length === 0) {
    throw new Error(
      "Kubernetes front-proxy client certificate has no common name");
  }

  return commonName;
}
