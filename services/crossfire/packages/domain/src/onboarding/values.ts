export type SetupDescriptor = {
  schemaVersion: 1;
  server: string;
  ownerBackendUserId: string;
  package: { name: 'fleet'; version: string };
  instructions: string;
};
