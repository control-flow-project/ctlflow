import type {
  TestKubernetes
} from "../../kubernetes/test-kubernetes.js";

export interface NodeTestServiceOptions {
  readonly kubernetes: TestKubernetes;
  readonly name: string;
  readonly image: string;
  readonly storageDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly workloadTokenAudience?: string;
}

export interface NodeTestService {
  readonly endpoint: string;
  readonly controlEndpoint: string;
  readonly diagnostics: () => string;
  readonly stop: () => Promise<void>;
}
