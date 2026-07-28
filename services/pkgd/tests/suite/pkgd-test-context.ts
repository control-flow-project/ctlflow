import type {
  PkgdTestContext
} from "../support/create-pkgd-test-context.js";

export const pkgdTestContextState: {
  current: PkgdTestContext | undefined;
} = {
  current: undefined
};
