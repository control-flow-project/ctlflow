import { writeSync, realpathSync, openSync, closeSync, fstatSync, constants } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { profile, profileName } from "@crossfire/contracts/client";
import { endpoint } from "@crossfire/contracts/origin";
import { privateDir, readJson } from "./index.js";

function gitExit(error: unknown, status: number): boolean {
  return error instanceof Error && 'status' in error && error.status === status
    && (!('code' in error) || error.code === undefined) && (!('signal' in error) || error.signal === null);
}

function gitFailure(message: string, error: unknown): Error {
  const detail = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code
    : error instanceof Error && 'status' in error && Number.isInteger(error.status) ? 'exit ' + String(error.status) : 'subprocess failure';
  return new Error(message + ' (' + detail + ')', { cause: error });
}

export function paths(project: string, name: string) {
  if (!profileName(name)) throw new Error("Profile names use 1..40 lowercase letters, digits and hyphens");
  const workspace = realpathSync(resolve(project));
  const root = join(workspace, ".crossfire");
  assertIgnored(workspace, name);
  privateDir(root);
  return { workspace, root, profile: join(root, "profiles", name + ".json"),
    pending: join(root, "profiles", name + ".pending.json"), state: join(root, "state", name),
    cursors: join(root, "state", name, "cursors.json") };
}

export function prepareProject(project: string): string {
  const workspace = realpathSync(resolve(project));
  ignoreProjectPaths(workspace, ['.crossfire/']);
  return workspace;
}

export function ignoreProjectPaths(workspace: string, paths: readonly string[]): void {
  if (paths.some(path => !path || path.startsWith('/') || path.split('/').includes('..') || /[\r\n\u0000]/u.test(path))) throw new Error('Git exclusions must be project-relative paths');
  try { execFileSync('git', ['-C', workspace, 'rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' }); }
  catch (error) {
    if (gitExit(error, 128)) return;
    throw gitFailure('Cannot run Git to protect project-local credentials', error);
  }
  const missing: string[] = [];
  for (const path of paths) {
    let tracked: string;
    try { tracked = execFileSync('git', ['-C', workspace, 'ls-files', '--', path], { encoding: 'utf8' }); }
    catch (error) { throw gitFailure('Cannot inspect tracked private project files', error); }
    if (tracked.trim()) throw new Error('Private project integration files are tracked by Git; remove them from tracking before connecting: ' + path);
    try { execFileSync('git', ['-C', workspace, 'check-ignore', '--quiet', '--', path.endsWith('/') ? path + 'check.json' : path], { stdio: 'pipe' }); }
    catch (error) {
      if (!gitExit(error, 1)) throw gitFailure('Cannot verify Git exclusions for this project', error);
      missing.push(path);
    }
  }
  if (!missing.length) return;
  const descriptor = openSync(join(workspace, '.gitignore'), constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o644);
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.uid !== process.getuid!() || info.size > 1024 * 1024) throw new Error('Cannot safely update this project’s .gitignore');
    writeSync(descriptor, '\n' + missing.join('\n') + '\n');
  } finally { closeSync(descriptor); }
}

function assertIgnored(workspace: string, name: string): void {
  try {
    execFileSync("git", ["-C", workspace, "rev-parse", "--is-inside-work-tree"], { stdio: "pipe" });
  } catch (error) {
    if (gitExit(error, 128)) {
      return;
    }
    throw gitFailure('Cannot run Git to verify project privacy', error);
  }
  try {
    for (const path of [".crossfire/profiles/" + name + ".json", ".crossfire/profiles/" + name + ".pending.json", ".crossfire/state/" + name]) {
      execFileSync("git", ["-C", workspace, "check-ignore", "--quiet", "--", path], { stdio: "pipe" });
    }
  } catch (error) {
    if (gitExit(error, 1)) throw new Error("Ignore .crossfire/ in this project's Git rules before using private agent state");
    throw gitFailure('Cannot verify private project Git exclusions', error);
  }
}


export function readProfile(path: string) {
  const result = profile(readJson<unknown>(path));
  if (!result.ok) throw new Error(result.error.message);
  const origin = endpoint(result.value.settings.homeserver);
  if (!origin.ok) throw new Error(origin.error.message);
  result.value.settings.homeserver = origin.value;
  return result.value;
}
