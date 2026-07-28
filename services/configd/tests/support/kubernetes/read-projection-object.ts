import type {
  TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  ProjectionOwners
} from "./provision-projection-owners.js";
import {
  deriveNativeName
} from "./derive-native-name.js";

export interface ProjectionObject {
  readonly apiVersion: string;
  readonly kind: string;
  readonly type?: string;
  readonly metadata: {
    readonly name: string;
    readonly namespace: string;
    readonly annotations: Readonly<Record<string, string>>;
    readonly ownerReferences: readonly {
      readonly apiVersion: string;
      readonly kind: string;
      readonly name: string;
      readonly uid: string;
      readonly controller: boolean;
      readonly blockOwnerDeletion: boolean;
    }[];
  };
  readonly data: Readonly<Record<string, string>>;
}

export async function readProjectionObject(
  kubernetes: TestKubernetes,
  owners: ProjectionOwners,
  kind: "configmap" | "secret",
  projectionId: string
): Promise<ProjectionObject> {
  const name = deriveNativeName(
    "ctlflow.configuration.v1.ProjectionObject",
    "prj-",
    projectionId);
  const result = await kubernetes.runKubectl([
    "get",
    kind,
    name,
    "--namespace",
    owners.namespaceName,
    "--output=json"
  ]);
  return JSON.parse(result.stdout) as ProjectionObject;
}
