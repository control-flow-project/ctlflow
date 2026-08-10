import type {
  TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  AuditdProductionService
} from "@ctlflow/auditd/testing/production";
import type {
  InvocationVerificationKey
} from "./invocation-verification-key.js";

export interface InvocationSigningProvision {
  readonly verificationKey: InvocationVerificationKey;
  readonly writePrivateKey: (path: string) => Promise<void>;
}

export interface PolicyServiceProvision {
  readonly endpoint: string;
  readonly serverName: string;
  readonly certificateAuthorityPath: string;
}

export interface StartIdentitydProductionServiceOptions {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
  readonly auditd: AuditdProductionService;
  readonly signing: InvocationSigningProvision;
  readonly telemetryEndpoint: string;
  readonly invocationIssuer: string;
  readonly invocationAudience: string;
  readonly invocationMaximumLifetimeSeconds: number;
  readonly principalFactCallers: readonly string[];
  readonly policy?: PolicyServiceProvision;
  readonly administrationCallers?: readonly string[];
}
