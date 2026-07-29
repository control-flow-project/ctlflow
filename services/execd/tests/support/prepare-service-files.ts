import {
  chmod,
  copyFile
} from "node:fs/promises";
import path from "node:path";
import {
  createTestServiceTls,
  type KustomizeServiceFiles,
  type TestKubernetes,
  type TestWorkloadCredentials
} from "@ctlflow/test-mesh";

export interface ServiceFileSource {
  readonly name: string;
  readonly path: string;
}

export interface PreparedServiceFiles {
  readonly certificateAuthorityPath: string;
  readonly serverName: string;
  readonly deployment: KustomizeServiceFiles;
}

export interface PrepareServiceFilesOptions {
  readonly repositoryRoot: string;
  readonly directory: string;
  readonly serviceName: string;
  readonly workload: TestWorkloadCredentials;
  readonly kubernetes: TestKubernetes;
  readonly trust: readonly ServiceFileSource[];
  readonly secrets?: readonly ServiceFileSource[];
}

export async function prepareServiceFiles(
  options: PrepareServiceFilesOptions
): Promise<PreparedServiceFiles> {
  const tls = await createTestServiceTls(
    options.repositoryRoot,
    options.directory,
    options.serviceName,
    [
      options.serviceName,
      `${options.serviceName}.${options.kubernetes.namespace}`,
      `${options.serviceName}.${options.kubernetes.namespace}.svc`
    ]);
  const trust = [
    {
      name: "workload-jwks.json",
      path: options.workload.jwksPath
    },
    {
      name: "kubernetes-client-ca.crt",
      path: options.kubernetes.api.certificateAuthorityPath
    },
    ...options.trust
  ];
  const copiedTrust = await copySources(options.directory, trust);
  const copiedSecrets = await copySources(
    options.directory,
    options.secrets ?? []);

  return {
    certificateAuthorityPath: tls.certificateAuthorityPath,
    serverName: tls.serverName,
    deployment: {
      secret: {
        "tls.crt": tls.certificatePath,
        "tls.key": tls.privateKeyPath,
        ...copiedSecrets
      },
      trust: copiedTrust
    }
  };
}

async function copySources(
  directory: string,
  sources: readonly ServiceFileSource[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const source of sources) {
    if (Object.hasOwn(result, source.name)
        || source.name.includes("/")
        || source.name.length === 0) {
      throw new Error("Test service file name is invalid");
    }
    const destination = path.join(directory, source.name);
    await copyFile(source.path, destination);
    await chmod(destination, 0o644);
    result[source.name] = destination;
  }
  return result;
}
