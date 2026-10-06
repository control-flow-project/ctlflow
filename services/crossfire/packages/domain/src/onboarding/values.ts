export type SetupDescriptor = {
  schemaVersion: 1;
  server: string;
  ownerMatrixId: string;
  package: { name: '@ctlflow/fleet'; version: string };
  instructions: string;
};
