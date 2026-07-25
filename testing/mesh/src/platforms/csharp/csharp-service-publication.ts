export interface CSharpServicePublicationOptions {
  readonly repositoryRoot: string;
  readonly projectPath: string;
  readonly diagnosticsManifestPath: string;
  readonly executableName: string;
}

export interface CSharpServicePublication {
  readonly directoryPath: string;
  readonly executablePath: string;
  readonly cacheHit: boolean;
  readonly stop: () => Promise<void>;
}
