import type {
  AuditdContractService
} from "@ctlflow/auditd/testing/stub";
import type {
  ControlledOidcProvider
} from "@ctlflow/authd/testing/provider";
import type {
  EgressdOidcBinding
} from "@ctlflow/egressd/testing/stub";
import type {
  IdentitydProductionService,
  IdentitydProductionSource
} from "@ctlflow/identityd/testing/production";
import type {
  CSharpStatelessService,
  OpenTelemetryCollector,
  TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  AuthdTestRuntime
} from "../runtime/authd-test-runtime.js";
import type {
  PreparedAuthdFiles
} from "../support/prepare-authd-files.js";

export interface AuthdTestSuite {
  readonly repositoryRoot: string;
  readonly runtime: AuthdTestRuntime;
  readonly kubernetes: TestKubernetes;
  readonly collector: OpenTelemetryCollector;
  readonly auditd: AuditdContractService;
  readonly identityd: IdentitydProductionService;
  readonly identitySource: IdentitydProductionSource;
  readonly provider: ControlledOidcProvider;
  readonly egressd: EgressdOidcBinding;
  readonly authd: CSharpStatelessService;
  readonly files: PreparedAuthdFiles;
  readonly stop: () => Promise<void>;
}

export const authdTestSuiteState: {
  current: AuthdTestSuite | undefined;
} = {
  current: undefined
};
