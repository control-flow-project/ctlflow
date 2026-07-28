import {
  pkgdTestContextState
} from "./pkgd-test-context.js";
import type {
  PkgdTestContext
} from "../support/create-pkgd-test-context.js";

export function getPkgdTestContext(): PkgdTestContext {
  if (pkgdTestContextState.current === undefined) {
    throw new Error("pkgd test context has not been started");
  }

  return pkgdTestContextState.current;
}
