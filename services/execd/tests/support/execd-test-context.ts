import type {
  CSharpService,
  TestWorkloadCredentials
} from "@ctlflow/test-mesh";
import type {
  AuditdProductionSource
} from "@ctlflow/auditd/testing/production";
import type {
  IdentitydProductionSource
} from "@ctlflow/identityd/testing/production";
import type {
  ExecutionServiceClient
} from "../generated/v1/execd.js";
import type {
  ConfigdTestService
} from "./dependencies/configd-test-service.js";
import type {
  PkgdTestService
} from "./dependencies/pkgd-test-service.js";
import type {
  TestDatabase
} from "./test-database.js";

export interface ExecdTestContext {
  readonly execdWorkload: TestWorkloadCredentials;
  readonly capabilityWorkload: TestWorkloadCredentials;
  readonly provisionerWorkload: TestWorkloadCredentials;
  readonly pkgd: PkgdTestService;
  readonly configd: ConfigdTestService;
  readonly process: CSharpService;
  readonly database: TestDatabase;
  readonly auditd: AuditdProductionSource;
  readonly identityd: IdentitydProductionSource;
  readonly client: ExecutionServiceClient;
  readonly capabilityClient: ExecutionServiceClient;
  readonly unadmittedOperatorClient: ExecutionServiceClient;
  readonly operatorSubject: string;
  readonly grpcPort: number;
  readonly probePort: number;
  readonly environment: Readonly<Record<string, string>>;
  readonly stop: () => Promise<void>;
}
