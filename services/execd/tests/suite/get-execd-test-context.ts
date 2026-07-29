import {
  execdTestContextState
} from "./execd-test-context.js";
import type {
  ExecdTestContext
} from "../support/execd-test-context.js";

export function getExecdTestContext(): ExecdTestContext {
  if (execdTestContextState.current === undefined) {
    throw new Error("execd test context has not been started");
  }
  return execdTestContextState.current;
}
