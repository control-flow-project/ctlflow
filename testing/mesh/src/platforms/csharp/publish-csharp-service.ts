import path from "node:path";
import type {
  CSharpServicePublication,
  CSharpServicePublicationOptions
} from "./csharp-service-publication.js";
import { cacheCSharpPublication } from
  "./publication-cache/cache-csharp-publication.js";
import { calculatePublicationFingerprint } from
  "./publication-cache/calculate-publication-fingerprint.js";
import { runCommand } from "../../processes/run-command.js";

export async function publishCSharpService(
  options: CSharpServicePublicationOptions
): Promise<CSharpServicePublication> {
  const fingerprint = await calculatePublicationFingerprint(options);
  return await cacheCSharpPublication(
    options,
    fingerprint,
    async (staging) => {
      await runCommand(
        "node",
        [
          path.join(
            options.repositoryRoot,
            "tooling/native/gated-publish.mjs"),
          options.projectPath,
          options.diagnosticsManifestPath,
          staging
        ],
        { cwd: options.repositoryRoot });
    });
}
