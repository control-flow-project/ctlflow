import { after } from "node:test";
import {
  stopIdentitydTestSuite
} from "../suite/stop-identityd-test-suite.js";

after(async () => {
  await stopIdentitydTestSuite();
});

await import("./api.test.js");
await import("./security.test.js");
await import("./keys.test.js");
await import("./principals.test.js");
await import("./groups.test.js");
await import("./sessions.test.js");
await import("./invocations.test.js");
await import("./cancellation.test.js");
await import("./telemetry.test.js");
await import("./zz-persistence.test.js");
