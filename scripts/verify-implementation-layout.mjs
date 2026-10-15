import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const implementationApplications = {
  crossfire: { node: 'server', csharp: 'Crossfire.Server' },
  fleetd: { node: 'daemon', csharp: 'Fleetd.Daemon' },
  fleet: { node: 'cli', csharp: 'Fleet.Cli' },
};
export const implementationPackages = {
  crossfire: { 'adapter-codex': 'Crossfire.AdapterCodex', 'adapter-crossfire': 'Crossfire.AdapterCrossfire', 'adapter-filesystem': 'Crossfire.AdapterFilesystem', 'adapter-matrix': 'Crossfire.AdapterMatrix', 'adapter-pi': 'Crossfire.AdapterPi', 'adapter-runtime': 'Crossfire.AdapterRuntime', 'adapter-schedule': 'Crossfire.AdapterSchedule', 'adapter-sqlite': 'Crossfire.AdapterSqlite', 'agent-core': 'Crossfire.AgentCore', contracts: 'Crossfire.Contracts', domain: 'Crossfire.Domain', kernel: 'Crossfire.Kernel', client: 'Crossfire.AdapterHttp' },
  fleetd: { 'adapter-execution': 'Fleetd.AdapterExecution', contracts: 'Fleetd.Contracts', domain: 'Fleetd.Domain', storage: 'Fleetd.Storage' },
  fleet: { 'daemon-client': 'Fleet.DaemonClient', 'ssh-transport': 'Fleet.SshTransport' },
};

export function verifyImplementationLayout(root) {
  for (const [service, applications] of Object.entries(implementationApplications)) {
    const directory = join(root, 'services', service);
    for (const [language, application] of Object.entries(applications)) {
      const implementation = join(directory, language);
      assert.deepEqual(readdirSync(join(implementation, 'apps')).sort(), [application], 'One owned application per implementation: ' + service + '/' + language);
      assert(existsSync(join(implementation, 'packages')), 'Implementation packages remain service-owned');
    }
    for (const [node, csharp] of Object.entries(implementationPackages[service])) {
      for (const [language, name] of [['node', node], ['csharp', csharp]]) assert(existsSync(join(directory, language, 'packages', name)), 'Matching semantic package ownership: ' + service + '/' + language + '/' + name);
    }
    if (service === 'fleetd') for (const file of ['execution', 'enrollment', 'failures', 'native-stops', 'reset']) assert(!existsSync(join(directory, 'node/apps/daemon/src', file + '.ts')), 'Native execution belongs to the execution adapter, not the daemon application');
    for (const name of ['packages', 'tools']) assert(!existsSync(join(directory, name)), 'Superseded service-level implementation path: ' + service + '/' + name);
    assert.deepEqual(readdirSync(join(directory, 'tests')).sort(), ['contracts'], 'Only common external contracts belong outside implementation tests');
    const sharedApplications = join(directory, 'apps');
    assert.deepEqual(existsSync(sharedApplications) ? readdirSync(sharedApplications).sort() : [], service === 'crossfire' ? ['web'] : [], 'One common UI, no duplicate or old backend application');
  }
  console.log('Implementation layout verified: symmetric Node/C# product owners; one common UI, database and external assertion bank.');
}
