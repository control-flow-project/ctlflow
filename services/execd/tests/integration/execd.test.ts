import { after } from "node:test";
import {
  stopExecdTestSuite
} from "../suite/stop-execd-test-suite.js";

after(async () => {
  await stopExecdTestSuite();
});

await import("./api.test.js");
await import("./audit-and-telemetry.test.js");
await import("./cancellation.test.js");
await import("./exposures.test.js");
await import("./lifecycle.test.js");
await import("./placements.test.js");
await import("./workloads.test.js");
await import("./reconciliation.test.js");
await import("./realization.test.js");
await import("./realization-failures.test.js");
await import("./runs.test.js");
await import("./security.test.js");
await import("./zz-persistence.test.js");
