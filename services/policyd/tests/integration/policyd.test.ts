import {
  after
} from "node:test";
import {
  stopPolicydTestSuite
} from "../suite/stop-policyd-test-suite.js";

after(async () => {
  await stopPolicydTestSuite();
});

await import("./api.test.js");
await import("./provisioning.test.js");
await import("./catalog.test.js");
await import("./rules.test.js");
await import("./principals.test.js");
await import("./security.test.js");
await import("./dependencies.test.js");
await import("./lifecycle.test.js");
await import("./telemetry.test.js");
