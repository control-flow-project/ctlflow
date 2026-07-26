import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type {
  KustomizeServiceOptions
} from "./kustomize-service.js";

export async function createKustomizeServiceOverlay(
  options: KustomizeServiceOptions,
  revision: number,
  replicas: number
): Promise<string> {
  validateOptions(options, revision, replicas);
  const overlays = path.join(
    options.repositoryRoot,
    ".temp/test-mesh/kubernetes/overlays");
  await mkdir(overlays, { recursive: true });
  const directory = await mkdtemp(
    path.join(overlays, `${options.name}-`));
  const secretFiles = await copyFiles(
    directory,
    "secret",
    options.files.secret,
    0o600);
  const trustFiles = await copyFiles(
    directory,
    "trust",
    options.files.trust,
    0o644);
  const persistentVolumeName = `${options.name}-test-data`;

  await writeJson(
    path.join(directory, "persistent-volume.json"),
    {
      apiVersion: "v1",
      kind: "PersistentVolume",
      metadata: { name: persistentVolumeName },
      spec: {
        accessModes: ["ReadWriteOnce"],
        capacity: { storage: "1Gi" },
        hostPath: {
          path: path.posix.join(
            options.kubernetes.storage.nodeRoot,
            options.storageDirectory),
          type: "Directory"
        },
        persistentVolumeReclaimPolicy: "Retain",
        storageClassName: ""
      }
    });
  await writeJson(
    path.join(directory, "persistent-volume-claim-patch.json"),
    {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: { name: `${options.name}-data` },
      spec: {
        storageClassName: "",
        volumeName: persistentVolumeName
      }
    });
  await writeJson(
    path.join(directory, "stateful-set-patch.json"),
    {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      metadata: { name: options.name },
      spec: {
        replicas,
        template: {
          metadata: {
            annotations: {
              "ctlflow.test/revision": String(revision)
            }
          },
          spec: {
            containers: [{
              name: options.name,
              imagePullPolicy: "Never"
            }]
          }
        }
      }
    });
  await writeJson(
    path.join(directory, "migration-job-patch.json"),
    {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: { name: `${options.name}-migrate` },
      spec: {
        template: {
          spec: {
            containers: [{
              name: "migrate",
              imagePullPolicy: "Never"
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
          .join("/"),
        "persistent-volume.json"
      ],
      patches: [
        { path: "persistent-volume-claim-patch.json" },
        { path: "stateful-set-patch.json" },
        { path: "migration-job-patch.json" }
      ],
      configMapGenerator: [
        {
          name: `${options.name}-runtime`,
          literals: Object.entries({
            ...options.environment,
            DOTNET_HOSTBUILDER__RELOADCONFIGONCHANGE: "false"
          })
            .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
            .map(([name, value]) => `${name}=${value}`)
        },
        {
          name: `${options.name}-trust`,
          files: trustFiles
        }
      ],
      secretGenerator: [{
        name: `${options.name}-tls`,
        type: "kubernetes.io/tls",
        files: secretFiles
      }],
      generatorOptions: {
        disableNameSuffixHash: true
      },
      images: [
        createImageReplacement(options.name, options.image),
        createImageReplacement(
          `${options.name}-migrations`,
          options.migrationImage)
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
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    if (!/^[A-Za-z0-9._-]+$/u.test(name) || !path.isAbsolute(source)) {
      throw new Error("Kustomize service file mapping is invalid");
    }

    const destination = path.join(target, name);
    await copyFile(source, destination);
    await chmod(destination, mode);
    mappings.push(`${name}=${path.posix.join(group, name)}`);
  }

  if (mappings.length === 0) {
    throw new Error("Kustomize service file group cannot be empty");
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
    throw new Error("Kustomize service image must have a tag");
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

function validateOptions(
  options: KustomizeServiceOptions,
  revision: number,
  replicas: number
): void {
  if (!/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/u.test(options.name)) {
    throw new Error("Kustomize service name is not a Kubernetes DNS label");
  }
  if (!path.isAbsolute(options.kustomizeBasePath)) {
    throw new Error("Kustomize service base path must be absolute");
  }
  if (!path.posix.isAbsolute(options.storageFilePath)) {
    throw new Error("Kustomize service storage file path must be absolute");
  }
  if (
    options.storageDirectory.length === 0
    || path.isAbsolute(options.storageDirectory)
    || options.storageDirectory.split(/[\\/]/u).some(
      (segment) => segment.length === 0
        || segment === "."
        || segment === "..")
  ) {
    throw new Error("Kustomize service storage directory is invalid");
  }
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Kustomize service revision must be positive");
  }
  if (replicas !== 0 && replicas !== 1) {
    throw new Error("Kustomize test service must have zero or one replica");
  }
}
