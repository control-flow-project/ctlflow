import type {
  KeyObject
} from "node:crypto";
import type {
  WorkloadVerificationSettings
} from "@ctlflow/test-mesh";
import type {
  IdentityServiceClient
} from "../generated/v1/identityd.js";
import type {
  InvocationValidationSettings
} from "./invocation-validation-settings.js";
import type {
  PolicySource
} from "./policy-source.js";

export interface PolicyStubState {
  readonly sources: Map<string, PolicySource>;
  readonly workloadSettings:
    WorkloadVerificationSettings;
  readonly workloadKeys:
    ReadonlyMap<string, KeyObject>;
  readonly identityClient: IdentityServiceClient;
  readonly identityCallTimeoutMilliseconds: number;
  readonly outboundWorkloadTokenPath: string;
  readonly invocationSettings:
    InvocationValidationSettings;
}
