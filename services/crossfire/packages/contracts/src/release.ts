import { fields, text } from "./management.js";
import { failure, success, type Result } from "../../kernel/src/result.js";

export const ARTIFACTS = ["README.md", "SKILL.md", "crossfire-client.mjs", "matrix-spec-LICENSE.txt"] as const;
export type ArtifactName = typeof ARTIFACTS[number];
export type Manifest = { release: string; version: string; artifacts: Record<ArtifactName, { bytes: number; sha256: string }> };
export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

export function artifactName(value: string): value is ArtifactName {
  return ARTIFACTS.some(name => name === value);
}

export function releaseName(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+-[a-f0-9]{24}$/u.test(value);
}

export function updateNotice(origin: string, installed: string | null, current: Manifest, skillHash?: string): string {
  const base = origin + '/onboarding/' + current.release + '/';
  return [
    'Crossfire update required: update the project-local client, skills and documentation.',
    'Installed release: ' + (installed ?? 'not reported') + '. Current release: ' + current.release + '.',
    skillHash === current.artifacts['SKILL.md'].sha256 ? 'The skill content is unchanged; it does not need to be re-read.'
      : 'Read the updated SKILL.md in this coding session after verifying the files.',
    'Inform the user. Run node .crossfire/client.mjs agent connect in this project. It verifies and installs the update, preserves identity/cursors and reconnects the listener. Do not enroll again.',
    'Manifest: ' + base + 'manifest.json',
    ...ARTIFACTS.map(name => name + ': ' + base + name + ' (' + current.artifacts[name].bytes + ' bytes; SHA-256 ' + current.artifacts[name].sha256 + ')'),
    'If this project has no managed client entry, use the verified bootstrap command on the management Connect an agent page. Do not create another identity.',
  ].join('\n');
}

export function manifest(value: unknown): Result<Manifest> {
  const input = fields(value, ["release", "version", "artifacts"]);
  if (!input.ok) return input;
  if (!releaseName(input.value.release) || !text(input.value.version, 40) || !/^\d+\.\d+\.\d+$/u.test(input.value.version)
    || !input.value.release.startsWith(input.value.version + "-")) return failure("invalid", "Invalid release identity");
  const artifacts = fields(input.value.artifacts, ARTIFACTS);
  if (!artifacts.ok) return artifacts;
  for (const name of ARTIFACTS) {
    const file = fields(artifacts.value[name], ["bytes", "sha256"]);
    if (!file.ok) return file;
    if (!Number.isSafeInteger(file.value.bytes) || Number(file.value.bytes) < 1 || Number(file.value.bytes) > MAX_ARTIFACT_BYTES
      || typeof file.value.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(file.value.sha256)) return failure("invalid", "Invalid bounded artifact metadata");
  }
  return success(input.value as Manifest);
}
