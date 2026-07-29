import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type {
  CSharpStatelessServiceOptions
} from "./csharp-stateless-service.js";

interface KustomizeGenerator {
  readonly name: string;
  readonly literals?: readonly string[];
  readonly files?: readonly string[];
}

export async function createStatelessServiceOverlay(
  options: CSharpStatelessServiceOptions,
  image: string,
  environment: Readonly<Record<string, string>>,
  revision: number
): Promise<string> {
  const root = path.join(
    options.repositoryRoot,
    ".temp/test-mesh/kubernetes/overlays");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(
    path.join(root, `${options.name}-`));
  const config = await copyFiles(
    directory,
    "config",
    options.files.config,
    0o644);
  const secret = await copyFiles(
    directory,
    "secret",
    options.files.secret,
    0o600);
  const trust = await copyFiles(
    directory,
    "trust",
    options.files.trust,
    0o644);

  const configMapGenerator: KustomizeGenerator[] = [
    {
      name: `${options.name}-runtime`,
      literals: Object.entries({
        ...environment,
        DOTNET_HOSTBUILDER__RELOADCONFIGONCHANGE: "false"
      })
        .sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0)
        .map(([name, value]) => `${name}=${value}`)
    }
  ];
  if (config.length > 0) {
    configMapGenerator.push({
      name: `${options.name}-provider-config`,
      files: config
    });
  }
  if (trust.length > 0) {
    configMapGenerator.push({
      name: `${options.name}-trust`,
      files: trust
    });
  }
  const secretGenerator: KustomizeGenerator[] = secret.length > 0
    ? [{
        name: `${options.name}-provider-secrets`,
        files: secret
      }]
    : [];

  await writeJson(
    path.join(directory, "deployment-patch.json"),
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: options.name },
      spec: {
        replicas: 1,
        template: {
          metadata: {
            annotations: {
              "ctlflow.test/revision": String(revision)
            }
          },
          spec: {
            containers: [{
              name: options.name,
              imagePullPolicy: "Never",
              env: Object.entries(environment)
                .sort(([left], [right]) =>
                  left < right ? -1 : left > right ? 1 : 0)
                .map(([name, value]) => ({ name, value }))
            }]
          }
        }
      }
    });
  await writeJson(
    path.join(directory, "kustomization.yaml"),
    {
      apiVersion: "kustomize.config.k8s.io/v1beta1",
      kind: "Kustomization",
      namespace: options.kubernetes.namespace,
      resources: [
        path.relative(directory, options.kustomizeBasePath)
          .split(path.sep)
          .join("/")
      ],
      patches: [{ path: "deployment-patch.json" }],
      configMapGenerator,
      secretGenerator,
      generatorOptions: {
        disableNameSuffixHash: true
      },
      images: [
        createImageReplacement(options.name, image),
        ...(options.additionalImages ?? []).map((value) =>
          createImageReplacement(value.name, value.image))
      ]
    });
  return directory;
}

async function copyFiles(
  directory: string,
  group: string,
  files: Readonly<Record<string, string>>,
  mode: number
): Promise<readonly string[]> {
  const target = path.join(directory, group);
  await mkdir(target, { recursive: true });
  const mappings: string[] = [];
  for (const [name, source] of Object.entries(files)
    .sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0)) {
    if (!/^[A-Za-z0-9._-]+$/u.test(name)
        || !path.isAbsolute(source)) {
      throw new Error("Stateless service file mapping is invalid");
    }
    const destination = path.join(target, name);
    await copyFile(source, destination);
    await chmod(destination, mode);
    mappings.push(`${name}=${path.posix.join(group, name)}`);
  }
  return mappings;
}

function createImageReplacement(
  name: string,
  image: string
): {
  readonly name: string;
  readonly newName: string;
  readonly newTag: string;
} {
  const separator = image.lastIndexOf(":");
  if (separator <= 0 || separator === image.length - 1) {
    throw new Error("Stateless service image must have a tag");
  }
  return {
    name,
    newName: image.slice(0, separator),
    newTag: image.slice(separator + 1)
  };
}

async function writeJson(file: string, value: object): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
