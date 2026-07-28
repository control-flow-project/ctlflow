import type {
  Knex
} from "knex";
import type {
  CSharpService
} from "@ctlflow/test-mesh";
import type {
  IdentitydMode,
  InvocationVerificationKey,
  PrincipalAuthorizationFacts
} from "@ctlflow/identityd/testing/production";
import type {
  PolicyState
} from "./policy-state.js";

export interface PolicydProductionService {
  readonly endpoint: string;
  readonly certificateAuthorityPath: string;
  readonly serverName: string;
  readonly identityCallerSubject: string;
  readonly database: Knex;
  readonly process: CSharpService;
  readonly replacePolicy: (state: PolicyState) => Promise<void>;
  readonly corruptPrincipalKind: (
    principalId: string,
    kind: "human" | "service"
  ) => Promise<void>;
  readonly setPrincipalFacts: (
    facts: readonly PrincipalAuthorizationFacts[]
  ) => Promise<void>;
  readonly setVerificationKeys: (response: {
    readonly keys: readonly InvocationVerificationKey[];
    readonly expiresAt: string;
  }) => Promise<void>;
  readonly setIdentityMode: (mode: IdentitydMode) => Promise<void>;
  readonly setAvailable: (available: boolean) => Promise<void>;
  readonly reconnectIdentity: () => Promise<void>;
  readonly stop: () => Promise<void>;
}
