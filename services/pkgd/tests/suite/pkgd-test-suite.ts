import type {
  OpenTelemetryCollector,
  TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  AuditdProductionService
} from "@ctlflow/auditd/testing/production";
import type {
  IdentitydProductionService
} from "@ctlflow/identityd/testing/production";
import type {
  PolicydProductionService
} from "@ctlflow/policyd/testing/production";
import type {
  PkgdTestRuntime
} from "../runtime/pkgd-test-runtime.js";
import type {
  InvocationAuthority
} from "../support/invocation-authority.js";

export interface PkgdTestSuite {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
  readonly collector: OpenTelemetryCollector;
  readonly auditd: AuditdProductionService;
  readonly identityd: IdentitydProductionService;
  readonly policyd: PolicydProductionService;
  readonly invocation: InvocationAuthority;
  readonly runtime: PkgdTestRuntime;
  readonly stop: () => Promise<void>;
}

export const pkgdTestSuiteState: {
  current: PkgdTestSuite | undefined;
} = {
  current: undefined
};
