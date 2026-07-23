export interface TestKubernetes {
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
  readonly stop: () => Promise<void>;
}
