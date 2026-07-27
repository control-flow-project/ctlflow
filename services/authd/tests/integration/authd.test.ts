import {
  after
} from "node:test";
import {
  stopAuthdTestSuite
} from "../suite/stop-authd-test-suite.js";

after(async () => {
  await stopAuthdTestSuite();
});

await import("./api.test.js");
await import("./begin.test.js");
await import("./callback.test.js");
await import("./logout.test.js");
await import("./bounds.test.js");
await import("./telemetry.test.js");
await import("./zz-lifecycle.test.js");
