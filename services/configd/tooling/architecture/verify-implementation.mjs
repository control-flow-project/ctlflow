import {
  fileURLToPath
} from "node:url";
import {
  verifyDurableService
} from "../../../../tooling/architecture/verify-durable-service.mjs";

await verifyDurableService(fileURLToPath(new URL("../../", import.meta.url)));
