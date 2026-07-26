import {
  validateWorkloadToken
} from "@ctlflow/test-mesh";
import type {
  IdentitydSource
} from "./identityd-source.js";
import type {
  IdentitydStubState
} from "./identityd-stub-state.js";

export type IdentitydAuthentication =
  | { readonly outcome: "unauthenticated" }
  | { readonly outcome: "unadmitted" }
  | {
      readonly outcome: "admitted";
      readonly source: IdentitydSource;
    };

export function authenticateIdentitydSource(
  state: IdentitydStubState,
  values: readonly (string | Buffer)[]
): IdentitydAuthentication {
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
      (source) =>
        source.callerSubject === subject);
    return source === undefined
      ? { outcome: "unadmitted" }
      : { outcome: "admitted", source };
  } catch {
    return { outcome: "unauthenticated" };
  }
}
