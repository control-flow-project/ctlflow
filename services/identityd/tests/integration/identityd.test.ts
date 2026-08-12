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
await import("./administration-security.test.js");
await import("./membership-administration.test.js");
await import("./group-administration.test.js");
await import("./virtual-principal-administration.test.js");
await import("./login-provider-administration.test.js");
await import("./external-link-administration.test.js");
await import("./mutation-serialization.test.js");
await import("./administration-observability.test.js");
await import("./administration-pagination.test.js");
await import("./sessions.test.js");
await import("./invocations.test.js");
await import("./cancellation.test.js");
await import("./telemetry.test.js");
await import("./zz-persistence.test.js");
