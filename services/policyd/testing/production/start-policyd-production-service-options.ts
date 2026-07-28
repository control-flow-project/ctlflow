import type {
  TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  IdentitydProductionService,
  InvocationVerificationKey,
  PrincipalAuthorizationFacts
} from "@ctlflow/identityd/testing/production";
import type {
  PolicyState
} from "./policy-state.js";

export interface StartPolicydProductionServiceOptions {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
  readonly identityd: IdentitydProductionService;
  readonly telemetryEndpoint: string;
  readonly invocationIssuer: string;
  readonly invocationAudience: string;
  readonly invocationMaximumLifetimeSeconds: number;
  readonly verificationKeys: {
    readonly keys: readonly InvocationVerificationKey[];
    readonly expiresAt: string;
  };
  readonly principalFacts: readonly PrincipalAuthorizationFacts[];
  readonly policy?: PolicyState;
}
