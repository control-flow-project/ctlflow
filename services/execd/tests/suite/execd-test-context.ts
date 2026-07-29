import type {
  ExecdTestContext
} from "../support/execd-test-context.js";

export const execdTestContextState: {
  current: ExecdTestContext | undefined;
} = {
  current: undefined
};
