import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  CSharpServicePublication
} from "./csharp-service-publication.js";
import type {
  TestKubernetes
} from "../../kubernetes/test-kubernetes.js";
import { runCommand } from "../../processes/run-command.js";

export async function buildCSharpServiceImage(
  repositoryRoot: string,
  imageName: string,
  containerfilePath: string,
  publication: CSharpServicePublication,
  kubernetes: TestKubernetes
): Promise<string> {
  const publicationFingerprint = path.basename(publication.directoryPath);
  if (!/^[a-f0-9]{64}$/u.test(publicationFingerprint)) {
    throw new Error("C# publication path has no content fingerprint");
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(imageName)) {
    throw new Error("C# service image name is invalid");
  }

  const fingerprint = createHash("sha256")
    .update("ctlflow-csharp-image-v1\0")
    .update(publicationFingerprint)
    .update("\0")
    .update(await readFile(containerfilePath))
    .update("\0")
    .update(await readFile(
      path.join(repositoryRoot, ".dockerignore")))
    .digest("hex");
  const image = `ctlflow-test-${imageName}:${fingerprint}`;
  if (!await imageExists(repositoryRoot, image)) {
    await runCommand(
      "docker",
      [
        "build",
        "--network=host",
        "--file",
        containerfilePath,
        "--tag",
        image,
        repositoryRoot
      ],
      { cwd: repositoryRoot });
  }

  await kubernetes.loadImage(image);
  return image;
}

async function imageExists(
  repositoryRoot: string,
  image: string
): Promise<boolean> {
  return await runCommand(
    "docker",
    ["image", "inspect", image],
    { cwd: repositoryRoot })
    .then(() => true)
    .catch(() => false);
}
