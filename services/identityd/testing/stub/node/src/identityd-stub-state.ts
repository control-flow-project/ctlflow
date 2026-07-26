import type {
  KeyObject
} from "node:crypto";
import type {
  WorkloadVerificationSettings
} from "@ctlflow/test-mesh";
import type {
  IdentitydSource
} from "./identityd-source.js";

export interface IdentitydStubState {
  readonly sources: Map<string, IdentitydSource>;
  readonly workloadSettings:
    WorkloadVerificationSettings;
  readonly workloadKeys:
    ReadonlyMap<string, KeyObject>;
}
