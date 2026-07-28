import {
  configdTestContextState
} from "./configd-test-context.js";
import type {
  ConfigdTestContext
} from "../support/create-configd-test-context.js";

export function getConfigdTestContext(): ConfigdTestContext {
  if (configdTestContextState.current === undefined) {
    throw new Error("configd test context has not been started");
  }

  return configdTestContextState.current;
}
