import { after } from "node:test";
import {
  stopTenantdTestSuite
} from "../suite/stop-tenantd-test-suite.js";

after(async () => {
  await stopTenantdTestSuite();
});

await import("./api.test.js");
await import("./audit-and-telemetry.test.js");
await import("./parent-child-concurrency.test.js");
await import("./security.test.js");
await import("./invocation-key-security.test.js");
await import("./tenants.test.js");
await import("./workspace-pagination.test.js");
await import("./workspaces.test.js");
await import("./zz-persistence.test.js");
