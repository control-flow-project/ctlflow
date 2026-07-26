import type { TestKubernetes } from "../../kubernetes/test-kubernetes.js";

export interface NodeTestImageOptions {
  readonly repositoryRoot: string;
  readonly imageName: string;
  readonly containerfilePath: string;
  readonly sourcePaths: readonly string[];
  readonly kubernetes: TestKubernetes;
}
