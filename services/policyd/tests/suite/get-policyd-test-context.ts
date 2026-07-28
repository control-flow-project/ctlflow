import type {
  PolicydTestContext
} from "../support/create-policyd-test-context.js";
import {
  policydTestContextState
} from "./policyd-test-context.js";

export function getPolicydTestContext(): PolicydTestContext {
  if (policydTestContextState.current === undefined) {
    throw new Error("policyd test context has not been started");
  }
  return policydTestContextState.current;
}
