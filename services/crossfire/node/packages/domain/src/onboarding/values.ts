export type SetupDescriptor = {
  schemaVersion: 1;
  server: string;
  ownerBackendUserId: string;
  package: { name: '@ctlflow/fleet'; version: string };
  instructions: string;
};
