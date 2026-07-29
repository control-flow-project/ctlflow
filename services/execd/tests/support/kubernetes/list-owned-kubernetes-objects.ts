import type {
  TestKubernetes
} from "@ctlflow/test-mesh";

export interface KubernetesObject {
  readonly metadata: {
    readonly name: string;
    readonly namespace?: string;
    readonly annotations: Readonly<Record<string, string>>;
  };
  readonly spec?: unknown;
  readonly status?: unknown;
}

export async function listOwnedKubernetesObjects(
  kubernetes: TestKubernetes,
  kind: string,
  annotations: Readonly<Record<string, string>>,
  namespace?: string
): Promise<readonly KubernetesObject[]> {
  const arguments_ = ["get", kind];
  if (namespace !== undefined) {
    arguments_.push("--namespace", namespace);
  }
  arguments_.push("--output", "json");
  const result = await kubernetes.runKubectl(arguments_);
  const parsed: unknown = JSON.parse(result.stdout);
  if (!isObjectList(parsed)) {
    throw new Error(`kubectl returned an invalid ${kind} list`);
  }

  return parsed.items
    .filter(isKubernetesObject)
    .filter((item) => Object.entries(annotations).every(
      ([name, value]) => item.metadata.annotations[name] === value));
}

function isObjectList(value: unknown): value is {
  readonly items: readonly unknown[];
} {
  return isRecord(value) && Array.isArray(value.items);
}

function isKubernetesObject(
  value: unknown
): value is KubernetesObject {
  if (!isRecord(value) || !isRecord(value.metadata)) {
    return false;
  }
  const metadata = value.metadata;
  if (typeof metadata.name !== "string") {
    return false;
  }
  if (metadata.namespace !== undefined
      && typeof metadata.namespace !== "string") {
    return false;
  }
  if (metadata.annotations !== undefined
      && !isStringRecord(metadata.annotations)) {
    return false;
  }
  if (metadata.annotations === undefined) {
    metadata.annotations = {};
  }
  return true;
}

function isStringRecord(
  value: unknown
): value is Record<string, string> {
  return isRecord(value)
    && Object.values(value).every(
      (item) => typeof item === "string");
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value);
}
