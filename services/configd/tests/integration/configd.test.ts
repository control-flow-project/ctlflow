import { after } from "node:test";
import {
  stopConfigdTestSuite
} from "../suite/stop-configd-test-suite.js";

after(async () => {
  await stopConfigdTestSuite();
});

await import("./api.test.js");
await import("./configurations.test.js");
await import("./secrets.test.js");
await import("./provisioner.test.js");
await import("./projections.test.js");
await import("./security.test.js");
await import("./invocation-security.test.js");
await import("./audit-and-telemetry.test.js");
await import("./cancellation.test.js");
await import("./zz-persistence.test.js");
