import {
  identitydTestContextState
} from "./identityd-test-context.js";
import type {
  IdentitydTestContext
} from "../support/create-identityd-test-context.js";

export function getIdentitydTestContext(): IdentitydTestContext {
  if (identitydTestContextState.current === undefined) {
    throw new Error("identityd test context has not been started");
  }

  return identitydTestContextState.current;
}
