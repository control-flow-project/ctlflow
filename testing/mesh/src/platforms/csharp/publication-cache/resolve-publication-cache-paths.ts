import path from "node:path";
import type {
  CSharpServicePublicationOptions
} from "../csharp-service-publication.js";

export interface PublicationCachePaths {
  readonly root: string;
  readonly directory: string;
  readonly manifest: string;
}

export function resolvePublicationCachePaths(
  options: CSharpServicePublicationOptions,
  fingerprint: string
): PublicationCachePaths {
  const serviceRoot = resolveServiceRoot(options.projectPath);
  const root = path.join(
    options.repositoryRoot,
    ".temp",
    "nativeaot",
    path.basename(serviceRoot));
  const directory = path.join(root, fingerprint);

  return {
    root,
    directory,
    manifest: path.join(directory, "ctlflow-publication.json")
  };
}

function resolveServiceRoot(projectPath: string): string {
  const marker = `${path.sep}csharp${path.sep}`;
  const markerIndex = projectPath.lastIndexOf(marker);
  if (markerIndex <= 0) {
    throw new Error("C# project path must belong to a service csharp directory");
  }

  return projectPath.slice(0, markerIndex);
}
