export interface TestServiceTls {
  readonly certificateAuthorityPath: string;
  readonly certificatePath: string;
  readonly privateKeyPath: string;
  readonly serverName: string;
}
