import type {
  ControlledOrigin
} from "@ctlflow/egressd/testing/origin";
import type {
  CSharpStatelessService,
  OpenTelemetryCollector,
  TestKubernetes,
  TestWorkloadCredentials
} from "@ctlflow/test-mesh";
import type {
  EgressdTestRuntime
} from "../runtime/egressd-test-runtime.js";
import type {
  EgressdTestFiles
} from "../support/prepare-egressd-files.js";

export interface EgressdTestSuite {
  readonly repositoryRoot: string;
  readonly runtime: EgressdTestRuntime;
  readonly kubernetes: TestKubernetes;
  readonly collector: OpenTelemetryCollector;
  readonly caller: TestWorkloadCredentials;
  readonly callerServiceAccount: string;
  readonly origin: ControlledOrigin;
  readonly files: EgressdTestFiles;
  readonly egressd: CSharpStatelessService;
  readonly stop: () => Promise<void>;
}

export const egressdTestSuiteState: {
  current: EgressdTestSuite | undefined;
} = {
  current: undefined
};
