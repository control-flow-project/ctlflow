import {
  after
} from "node:test";
import {
  stopEgressdTestSuite
} from "../suite/stop-egressd-test-suite.js";

after(async () => {
  await stopEgressdTestSuite();
});

await import("./api.test.js");
await import("./authentication.test.js");
await import("./rules.test.js");
await import("./headers.test.js");
await import("./bounds.test.js");
await import("./streaming.test.js");
await import("./telemetry.test.js");
await import("./capacity.test.js");
await import("./zz-startup.test.js");
