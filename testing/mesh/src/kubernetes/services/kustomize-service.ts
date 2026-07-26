import type {
  TestKubernetes
} from "../test-kubernetes.js";

export interface KustomizeServiceFiles {
  readonly secret: Readonly<Record<string, string>>;
  readonly trust: Readonly<Record<string, string>>;
}

export interface KustomizeServiceOptions {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
  readonly name: string;
  readonly kustomizeBasePath: string;
  readonly image: string;
  readonly migrationImage: string;
  readonly storageDirectory: string;
  readonly storageFilePath: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly files: KustomizeServiceFiles;
}
