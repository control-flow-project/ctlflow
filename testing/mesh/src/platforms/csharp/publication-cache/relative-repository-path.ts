import path from "node:path";

export function relativeRepositoryPath(
  repositoryRoot: string,
  filePath: string
): string {
  const relative = path.relative(repositoryRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Publication input must be inside the repository");
  }

  return relative.split(path.sep).join("/");
}
