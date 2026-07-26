import {
  validateWorkloadToken
} from "@ctlflow/test-mesh";
import type {
  PolicySource
} from "./policy-source.js";
import type {
  PolicyStubState
} from "./policy-stub-state.js";

export type PolicyAuthentication =
  | { readonly outcome: "unauthenticated" }
  | { readonly outcome: "unadmitted" }
  | {
      readonly outcome: "admitted";
      readonly source: PolicySource;
    };

export function authenticatePolicySource(
  state: PolicyStubState,
  values: readonly (string | Buffer)[]
): PolicyAuthentication {
  if (
    values.length !== 1
    || typeof values[0] !== "string"
    || !values[0].startsWith("Bearer ")
  ) {
    return { outcome: "unauthenticated" };
  }

  try {
    const subject = validateWorkloadToken(
      values[0].slice("Bearer ".length),
      state.workloadSettings,
      state.workloadKeys);
    const source = [...state.sources.values()].find(
      (candidate) =>
        candidate.callerSubject === subject);
    return source === undefined
      ? { outcome: "unadmitted" }
      : { outcome: "admitted", source };
  } catch {
    return { outcome: "unauthenticated" };
  }
}
