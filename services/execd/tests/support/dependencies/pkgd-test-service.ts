import type {
  CSharpService
} from "@ctlflow/test-mesh";
import type {
  AuditdProductionSource
} from "@ctlflow/auditd/testing/production";
import type {
  IdentitydProductionSource
} from "@ctlflow/identityd/testing/production";
import type {
  PackageServiceClient
} from "../../generated/v1/pkgd.js";
import type {
  TestDatabase
} from "../test-database.js";

export interface PkgdTestService {
  readonly endpoint: string;
  readonly serverName: string;
  readonly certificateAuthorityPath: string;
  readonly client: PackageServiceClient;
  readonly process: CSharpService;
  readonly database: TestDatabase;
  readonly auditd: AuditdProductionSource;
  readonly identityd: IdentitydProductionSource;
  readonly stop: () => Promise<void>;
}
