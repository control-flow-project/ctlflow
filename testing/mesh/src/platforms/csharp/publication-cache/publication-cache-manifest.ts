export interface PublicationCacheFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export interface PublicationCacheManifest {
  readonly schemaVersion: 1;
  readonly fingerprint: string;
  readonly executableName: string;
  readonly files: readonly PublicationCacheFile[];
}
