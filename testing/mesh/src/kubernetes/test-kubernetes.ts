export interface TestWorkloadCredentials {
  readonly issuer: string;
  readonly audience: string;
  readonly callerSubject: string;
  readonly callerToken: string;
  readonly expiredToken: string;
  readonly overlongToken: string;
  readonly unadmittedToken: string;
  readonly wrongAudienceToken: string;
  readonly unboundToken: string;
  readonly jwksPath: string;
}

export interface TestCallerCredentials {
  readonly callerSubject: string;
  readonly callerToken: string;
}

export interface TestLifecycleOwnerCredentials {
  readonly identity: TestCallerCredentials;
  readonly configuration: TestCallerCredentials;
  readonly execution: TestCallerCredentials;
  readonly packages: TestCallerCredentials;
}

export interface TestKubernetesApiCredentials {
  readonly endpoint: string;
  readonly certificateAuthorityPath: string;
  readonly clientCertificatePath: string;
  readonly clientKeyPath: string;
}

export interface TestAggregationCredentials {
  readonly serverCertificateAuthorityPath: string;
  readonly serverCertificatePath: string;
  readonly serverKeyPath: string;
  readonly requestHeaderCertificateAuthorityPath: string;
  readonly requestHeaderClientCertificatePath: string;
  readonly requestHeaderClientKeyPath: string;
  readonly unadmittedClientCertificatePath: string;
  readonly unadmittedClientKeyPath: string;
  readonly allowedClientName: string;
}

export interface RegisterTestAggregatedApiOptions {
  readonly group: string;
  readonly version: string;
  readonly serviceName: string;
  readonly serviceNamespace: string;
  readonly hostPort: number;
  readonly serverCertificateAuthorityPath: string;
}

export interface TestKubernetes {
  readonly aggregation: TestAggregationCredentials;
  readonly api: TestKubernetesApiCredentials;
  readonly createWorkloadCredentials:
    () => Promise<TestWorkloadCredentials>;
  readonly createLifecycleOwnerCredentials:
    () => Promise<TestLifecycleOwnerCredentials>;
  readonly registerAggregatedApi:
    (options: RegisterTestAggregatedApiOptions) => Promise<void>;
  readonly stop: () => Promise<void>;
}
