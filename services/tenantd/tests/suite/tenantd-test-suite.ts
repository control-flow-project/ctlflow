import type {
  CSharpServicePublication,
  OpenTelemetryCollector,
  TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  AuditdContractService
} from "../dependencies/auditd/auditd-contract-service.js";

export interface TenantdTestSuite {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
  readonly collector: OpenTelemetryCollector;
  readonly auditd: AuditdContractService;
  readonly publication: CSharpServicePublication;
  readonly stop: () => Promise<void>;
}

export const tenantdTestSuiteState: {
  current: TenantdTestSuite | undefined;
} = {
  current: undefined
};
