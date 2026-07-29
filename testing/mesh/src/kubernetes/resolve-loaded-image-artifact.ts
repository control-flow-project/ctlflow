import type {
  TestContainerArtifact
} from "./test-container-artifact.js";
import type { TestMinikube } from "./test-minikube.js";
import { runMinikube } from "./run-minikube.js";

export async function resolveLoadedImageArtifact(
  repositoryRoot: string,
  minikube: TestMinikube,
  image: string
): Promise<TestContainerArtifact> {
  const canonical = image.includes("/")
    ? image
    : `docker.io/library/${image}`;
  const result = await runMinikube(
    repositoryRoot,
    minikube,
    [
      "ssh",
      "--",
      "sudo",
      "ctr",
      "--namespace",
      "k8s.io",
      "images",
      "check",
      `name==${canonical}`
    ]);
  const rows = result.stdout
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${canonical} `));
  if (rows.length !== 1) {
    throw new Error("Loaded image has no unique containerd manifest");
  }

  const fields = rows[0]!.split(/\s+/u);
  const manifestDigest = fields[2];
  const tagSeparator = canonical.lastIndexOf(":");
  if (manifestDigest === undefined
      || !/^sha256:[a-f0-9]{64}$/u.test(manifestDigest)
      || tagSeparator <= canonical.lastIndexOf("/")) {
    throw new Error("Loaded image manifest is invalid");
  }

  const repository = canonical.slice(0, tagSeparator);
  await runMinikube(
    repositoryRoot,
    minikube,
    [
      "ssh",
      "--",
      "sudo",
      "ctr",
      "--namespace",
      "k8s.io",
      "images",
      "tag",
      "--force",
      canonical,
      `${repository}@${manifestDigest}`
    ]);
  return {
    repository,
    manifestDigest
  };
}
