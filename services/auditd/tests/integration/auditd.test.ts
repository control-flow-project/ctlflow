import { after } from "node:test";
import {
  stopAuditdTestSuite
} from "../suite/stop-auditd-test-suite.js";

after(async () => {
  await stopAuditdTestSuite();
});

await import("./api.test.js");
await import("./acceptance.test.js");
await import("./success-matrix.test.js");
await import("./security.test.js");
await import("./admission.test.js");
await import("./envelope-validation.test.js");
await import("./detail-validation.test.js");
await import("./identity-detail-validation.test.js");
await import("./batch-semantics.test.js");
await import("./cancellation.test.js");
await import("./telemetry.test.js");
await import("./zz-persistence.test.js");
