import path from "node:path";

export function resolveServiceRoot(projectPath: string): string {
  const marker = `${path.sep}csharp${path.sep}`;
  const markerIndex = projectPath.lastIndexOf(marker);
  if (markerIndex <= 0) {
    throw new Error(
      "C# project path must belong to a service csharp directory");
  }

  return projectPath.slice(0, markerIndex);
}
