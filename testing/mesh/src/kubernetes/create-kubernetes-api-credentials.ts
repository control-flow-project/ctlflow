import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  TestKubernetesApiCredentials
} from "./test-kubernetes.js";

export async function createKubernetesApiCredentials(
  kubeconfigPath: string,
  directory: string
): Promise<TestKubernetesApiCredentials> {
  const kubeconfig = await readFile(kubeconfigPath, "utf8");
  const endpoint = readKubeconfigValue(kubeconfig, "server");
  const certificateAuthority = Buffer.from(
    readKubeconfigValue(kubeconfig, "certificate-authority-data"),
    "base64");
  const clientCertificate = Buffer.from(
    readKubeconfigValue(kubeconfig, "client-certificate-data"),
    "base64");
  const clientKey = Buffer.from(
    readKubeconfigValue(kubeconfig, "client-key-data"),
    "base64");
  const certificateAuthorityPath = path.join(
    directory,
    "kubernetes-api-ca.crt");
  const clientCertificatePath = path.join(
    directory,
    "kubernetes-api-client.crt");
  const clientKeyPath = path.join(
    directory,
    "kubernetes-api-client.key");
  await Promise.all([
    writeFile(certificateAuthorityPath, certificateAuthority),
    writeFile(clientCertificatePath, clientCertificate),
    writeFile(clientKeyPath, clientKey)
  ]);

  return {
    endpoint,
    certificateAuthorityPath,
    clientCertificatePath,
    clientKeyPath
  };
}

function readKubeconfigValue(
  kubeconfig: string,
  name: string
): string {
  const escapedName = name.replace(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&");
  const expression = new RegExp(
    `^\\s*${escapedName}:\\s*(\\S+)\\s*$`,
    "mu");
  const value = expression.exec(kubeconfig)?.[1];
  if (value === undefined || value.length === 0) {
    throw new Error(`Kubeconfig does not contain ${name}`);
  }

  return value;
}
