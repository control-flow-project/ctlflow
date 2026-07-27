import type {
  CSharpServicePublication
} from "./csharp-service-publication.js";
import type {
  TestKubernetes
} from "../../kubernetes/test-kubernetes.js";

export interface StatelessServiceFiles {
  readonly config: Readonly<Record<string, string>>;
  readonly secret: Readonly<Record<string, string>>;
  readonly trust: Readonly<Record<string, string>>;
}

export interface CSharpStatelessServiceOptions {
  readonly repositoryRoot: string;
  readonly publication: CSharpServicePublication;
  readonly kubernetes: TestKubernetes;
  readonly name: string;
  readonly imageName: string;
  readonly containerfilePath: string;
  readonly kustomizeBasePath: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly files: StatelessServiceFiles;
}

export interface CSharpStatelessService {
  readonly executablePath: string;
  readonly serviceAccountSubject: string;
  readonly publicPort: number;
  readonly probePort: number;
  readonly diagnostics: () => string;
  readonly reconnect: () => Promise<void>;
  readonly restart: (
    environment?: Readonly<Record<string, string>>
  ) => Promise<void>;
  readonly stop: () => Promise<void>;
}
