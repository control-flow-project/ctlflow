import type { TestToolchain } from "./test-toolchain.js";

export interface TestMinikube {
  readonly executable: string;
  readonly toolchain: TestToolchain;
}
