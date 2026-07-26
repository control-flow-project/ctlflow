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
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(
      publication.executableName)) {
    throw new Error("C# publication executable name is invalid");
  }

  const runtimeImage = readFinalRuntimeImage(
    await readFile(containerfilePath, "utf8"));
  const fingerprint = createHash("sha256")
    .update("ctlflow-csharp-image-v2\0")
    .update(publicationFingerprint)
    .update("\0")
    .update(runtimeImage)
    .update("\0")
    .update(publication.executableName)
    .digest("hex");
  const image = `ctlflow-test-${imageName}:${fingerprint}`;
  if (!await imageExists(repositoryRoot, image)) {
    const containerfile = [
      `FROM ${runtimeImage}`,
      "WORKDIR /app",
      "COPY . ./",
      "USER 65532:65532",
      `ENTRYPOINT ["/app/${publication.executableName}"]`,
      ""
    ].join("\n");
    await runCommand(
      "docker",
      [
        "build",
        "--network=host",
        "--file",
        "-",
        "--tag",
        image,
        publication.directoryPath
      ],
      {
        cwd: repositoryRoot,
        input: containerfile
      });
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

function readFinalRuntimeImage(containerfile: string): string {
  const images = containerfile
    .split(/\r?\n/u)
    .map((line) => /^FROM\s+(\S+)(?:\s+AS\s+\S+)?\s*$/iu.exec(
      line.trim())?.[1])
    .filter((image): image is string => image !== undefined);
  const image = images.at(-1);
  if (image === undefined
      || image.startsWith("$")
      || image.includes("${")) {
    throw new Error(
      "C# Containerfile must end with a concrete runtime image");
  }

  return image;
}
