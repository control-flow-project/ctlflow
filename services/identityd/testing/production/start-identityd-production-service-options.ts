import type {
  TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  AuditdContractService
} from "@ctlflow/auditd/testing/stub";
import type {
  InvocationVerificationKey
} from "./invocation-verification-key.js";

export interface InvocationSigningProvision {
  readonly verificationKey: InvocationVerificationKey;
  readonly writePrivateKey: (path: string) => Promise<void>;
}

export interface StartIdentitydProductionServiceOptions {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
  readonly auditd: AuditdContractService;
  readonly signing: InvocationSigningProvision;
  readonly telemetryEndpoint: string;
  readonly invocationIssuer: string;
  readonly invocationAudience: string;
  readonly invocationMaximumLifetimeSeconds: number;
  readonly verificationKeyCallers: readonly string[];
  readonly principalFactCallers: readonly string[];
}
