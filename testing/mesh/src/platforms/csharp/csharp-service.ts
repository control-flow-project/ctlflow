import type {
  CSharpServicePublication
} from "./csharp-service-publication.js";
import type {
  TestKubernetes
} from "../../kubernetes/test-kubernetes.js";
import type {
  KustomizeServiceFiles
} from "../../kubernetes/services/kustomize-service.js";

export interface CSharpServiceOptions {
  readonly repositoryRoot: string;
  readonly publication: CSharpServicePublication;
  readonly kubernetes: TestKubernetes;
  readonly name: string;
  readonly imageName: string;
  readonly containerfilePath: string;
  readonly migrationImage: string;
  readonly kustomizeBasePath: string;
  readonly storageDirectory: string;
  readonly storageFilePath: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly files: KustomizeServiceFiles;
}

export interface CSharpService {
  readonly executablePath: string;
  readonly serviceAccountSubject: string;
  readonly grpcPort: number;
  readonly probePort: number;
  readonly diagnostics: () => string;
  readonly reconnect: () => Promise<void>;
  readonly restart: (
    environment?: Readonly<Record<string, string>>
  ) => Promise<void>;
  readonly stop: () => Promise<void>;
}
