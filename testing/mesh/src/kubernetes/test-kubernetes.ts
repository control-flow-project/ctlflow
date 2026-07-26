export interface TestWorkloadCredentials {
  readonly issuer: string;
  readonly audience: string;
  readonly callerSubject: string;
  readonly callerToken: string;
  readonly expiredToken: string;
  readonly overlongToken: string;
  readonly unadmittedToken: string;
  readonly wrongAudienceToken: string;
  readonly unboundToken: string;
  readonly jwksPath: string;
}

export interface TestKubernetesApiCredentials {
  readonly endpoint: string;
  readonly certificateAuthorityPath: string;
  readonly clientCertificatePath: string;
  readonly clientKeyPath: string;
  readonly clientSubject: string;
}

export interface TestKubernetesStorage {
  readonly hostRoot: string;
  readonly nodeRoot: string;
}

export interface TestKubernetes {
  readonly namespace: string;
  readonly api: TestKubernetesApiCredentials;
  readonly storage: TestKubernetesStorage;
  readonly createWorkloadCredentials:
    (serviceAccountName?: string) =>
      Promise<TestWorkloadCredentials>;
  readonly createOperatorCredentials:
    (subject: string) => Promise<TestOperatorCredentials>;
  readonly loadImage: (image: string) => Promise<void>;
  readonly runKubectl: (
    arguments_: readonly string[],
    input?: string
  ) => Promise<CommandResult>;
  readonly startKubectl: (
    arguments_: readonly string[]
  ) => ManagedProcess;
  readonly stop: () => Promise<void>;
}
import type {
  CommandResult
} from "../processes/command-result.js";
import type {
  ManagedProcess
} from "../processes/managed-process.js";
import type {
  TestOperatorCredentials
} from "./test-operator-credentials.js";
