import type {
  IdentitydTestContext
} from "../support/create-identityd-test-context.js";

export const identitydTestContextState: {
  current: IdentitydTestContext | undefined;
} = {
  current: undefined
};
