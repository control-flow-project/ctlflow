export interface CSharpServicePublicationOptions {
  readonly repositoryRoot: string;
  readonly projectPath: string;
  readonly diagnosticsManifestPath: string;
  readonly executableName: string;
}

export interface CSharpContainerServicePublicationOptions
  extends CSharpServicePublicationOptions {
  readonly containerfilePath: string;
}

export interface CSharpServicePublication {
  readonly directoryPath: string;
  readonly executablePath: string;
  readonly executableName: string;
  readonly cacheHit: boolean;
  readonly stop: () => Promise<void>;
}
