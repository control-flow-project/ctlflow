import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

const forbiddenDomain = /\b(?:Crossfire\.(?:Contracts|Adapter\w+|Server|Ef\w+)|Fleetd\.(?:Contracts|Storage|Adapter\w+|Daemon)|Fleet\.(?:Cli|DaemonClient|SshTransport)|Microsoft\.(?:AspNetCore|Data\.Sqlite|EntityFrameworkCore)|System\.Net\.Http)\b/u;
const executableCore = /\b(?:ListenerReceiver|ListenerRunner|ListenerHost|ListenerControl|OwnerObservation|DecisionBroker|MessageArtifacts|HistoryQueries|UnreadMessages|ReceivePages)\b/u;
const pure = new Map([
  ['Crossfire.Kernel', new Set()],
  ['Crossfire.Domain', new Set(['Crossfire.Kernel'])],
  ['Crossfire.Contracts', new Set(['Crossfire.Kernel', 'Crossfire.Domain'])],
  ['Fleetd.Domain', new Set(['Crossfire.Kernel', 'Crossfire.Domain', 'Crossfire.AgentCore'])],
]);

export function csharpSourceViolations(project, source) {
  const violations = [];
  if (project.endsWith('.Domain') && (forbiddenDomain.test(source) || executableCore.test(source))) violations.push('Domain code depends on transport, wire validation or an executable listener owner');
  if (project === 'Crossfire.Kernel' && /\b(?:Crossfire\.(?!Kernel\b)\w+|Fleetd\.\w+|Fleet\.\w+|Microsoft\.(?:AspNetCore|Data\.Sqlite|EntityFrameworkCore))\b/u.test(source)) violations.push('Kernel depends on a product layer');
  return violations;
}

export function csharpReferenceViolations(owner, dependency) {
  const violations = [], allowed = pure.get(owner.name);
  if (allowed && !allowed.has(dependency.name)) violations.push('Pure project dependency is outside its owning layer');
  if (owner.kind !== 'tests' && owner.kind !== 'build' && (dependency.kind === 'build' || dependency.kind === 'tests')) violations.push('Product runtime depends on test or build-only software');
  if (owner.kind !== 'tests' && owner.kind !== 'build' && dependency.kind === 'apps') violations.push('Product imports application source instead of package exports');
  return violations;
}

function files(directory, extension) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? ['bin', 'obj', '.temp'].includes(entry.name) ? [] : files(join(directory, entry.name), extension)
    : entry.isFile() && entry.name.endsWith(extension) ? [join(directory, entry.name)] : []);
}

export function verifyCsharpArchitecture(root) {
  const projects = new Map(), violations = [];
  for (const service of ['crossfire', 'fleetd', 'fleet']) for (const kind of ['apps', 'packages', 'tests', 'build']) {
    for (const path of files(join(root, 'services', service, 'csharp', kind), '.csproj')) {
      projects.set(resolve(path), { name: basename(path, '.csproj'), service, kind, path });
    }
  }
  assert(projects.size > 0, 'C# projects must exist');
  for (const project of projects.values()) {
    const document = readFileSync(project.path, 'utf8');
    if (project.name.endsWith('.Domain') || project.name === 'Crossfire.Kernel') {
      if (/<(?:PackageReference|FrameworkReference)\b/u.test(document) || /Sdk="Microsoft\.NET\.Sdk\.Web"/u.test(document)) violations.push(project.path + ': pure project references concrete framework/storage packages');
    }
    for (const matched of document.matchAll(/<ProjectReference\b[^>]*\bInclude="([^"]+)"/gu)) {
      const reference = matched[1];
      if (reference.includes('$(')) {
        if (project.name !== 'Crossfire.EfHost' || project.kind !== 'build' || reference !== '$(CrossfireEfTargetProject)') violations.push(project.path + ': undeclared dynamic project dependency');
        continue;
      }
      const dependency = projects.get(resolve(dirname(project.path), reference));
      if (!dependency) { violations.push(project.path + ': dependency has no service-owned project: ' + reference); continue; }
      for (const message of csharpReferenceViolations(project, dependency)) violations.push(relative(root, project.path) + ': ' + message + ': ' + dependency.name);
    }
    for (const path of files(dirname(project.path), '.cs')) for (const message of csharpSourceViolations(project.name, readFileSync(path, 'utf8'))) violations.push(relative(root, path) + ': ' + message);
  }
  assert.deepEqual(violations, [], 'C# dependency ownership must match the common architecture');
  console.log('C# architecture verified: ' + projects.size + ' service-owned projects; pure domains and build/runtime separation.');
}
