import {
  after
} from "node:test";
import {
  stopEdgedTestSuite
} from "../suite/stop-edged-test-suite.js";

after(async () => {
  await stopEdgedTestSuite();
});

await import("./api.test.js");
await import("./sessions.test.js");
await import("./proxy.test.js");
await import("./bounds.test.js");
await import("./streaming.test.js");
await import("./telemetry.test.js");
await import("./zz-startup.test.js");
