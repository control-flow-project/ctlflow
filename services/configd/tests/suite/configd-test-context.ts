import type {
  ConfigdTestContext
} from "../support/create-configd-test-context.js";

export const configdTestContextState: {
  current: ConfigdTestContext | undefined;
} = {
  current: undefined
};
