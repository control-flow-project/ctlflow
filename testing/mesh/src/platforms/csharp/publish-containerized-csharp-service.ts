import type {
  CSharpContainerServicePublicationOptions,
  CSharpServicePublication
} from "./csharp-service-publication.js";
import { cacheCSharpPublication } from
  "./publication-cache/cache-csharp-publication.js";
import {
  calculateContainerPublicationFingerprint
} from
  "./publication-cache/calculate-container-publication-fingerprint.js";
import { runCommand } from "../../processes/run-command.js";

export async function publishContainerizedCSharpService(
  options: CSharpContainerServicePublicationOptions
): Promise<CSharpServicePublication> {
  const fingerprint =
    await calculateContainerPublicationFingerprint(options);
  const image = `ctlflow-nativeaot-publication:${fingerprint}`;
  return await cacheCSharpPublication(
    options,
    fingerprint,
    async (staging) => {
      await runCommand(
        "docker",
        [
          "build",
          "--network=host",
          "--file",
          options.containerfilePath,
          "--target",
          "publication",
          "--tag",
          image,
          options.repositoryRoot
        ],
        { cwd: options.repositoryRoot });
      const container = (await runCommand(
        "docker",
        ["create", image, "/unused"],
        { cwd: options.repositoryRoot })).stdout.trim();
      if (!/^[a-f0-9]{64}$/u.test(container)) {
        throw new Error("Docker returned an invalid publication container ID");
      }

      try {
        await runCommand(
          "docker",
          ["cp", `${container}:/.`, staging],
          { cwd: options.repositoryRoot });
      } finally {
        await runCommand(
          "docker",
          ["rm", "--force", container],
          { cwd: options.repositoryRoot }).catch(() => undefined);
      }
    });
}
