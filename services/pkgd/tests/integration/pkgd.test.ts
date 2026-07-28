import { after } from "node:test";
import {
  stopPkgdTestSuite
} from "../suite/stop-pkgd-test-suite.js";

after(async () => {
  await stopPkgdTestSuite();
});

await import("./api.test.js");
await import("./packages.test.js");
await import("./package-content-and-limits.test.js");
await import("./apps.test.js");
await import("./security.test.js");
await import("./invocation-security.test.js");
await import("./audit-and-telemetry.test.js");
await import("./zz-persistence.test.js");
