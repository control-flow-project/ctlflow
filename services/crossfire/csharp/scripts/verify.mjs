import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTestResources } from '../../../../scripts/test-resources.mjs';
import { migrateDatabase } from '@ctlflow/crossfire-data/management/sqlite/configuration';
import { prepareTimeZones } from '../tests/native-time-zones.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const service = join(root, 'services/crossfire');
const dotnet = process.env.DOTNET_EXECUTABLE ?? 'dotnet';
if (process.argv.length !== 2) throw new Error('Core C# verification takes no optional runtime or suite flags');
const resources = verifyTestResources();
const temporaryRoot = join(service, '.temp'); mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
const directory = mkdtempSync(join(temporaryRoot, 'csharp-core-'));
const publish = join(directory, 'native');
const events = [];
const disposers = [];
let timeZones;

async function command(binary, arguments_, label, workingDirectory = root) {
  const start = performance.now();
  const result = await new Promise((complete, reject) => {
    const child = spawn(binary, arguments_, { cwd: workingDirectory, stdio: 'inherit', env: { ...process.env,
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
      DOTNET_CLI_DO_NOT_USE_MSBUILD_SERVER: '1', MSBUILDDISABLENODEREUSE: '1', UseSharedCompilation: 'false', TZDIR: timeZones } });
    child.once('error', reject); child.once('exit', (code, signal) => complete({ code, signal }));
  });
  events.push({ label, elapsedMs: Math.round(performance.now() - start), ...result });
  if (result.code !== 0) throw new Error(label + ' failed: ' + (result.signal ?? result.code));
}

try {
  timeZones = prepareTimeZones(directory);
  const { secureRouter } = await import('../../node/packages/test-support/dist/tls.js');
  const backend = await secureRouter({ after: operation => disposers.push(operation) }, createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ host: request.headers.host }));
  }));
  process.env.CROSSFIRE_TLS_TEST_ORIGIN = backend.origin;
  await command(process.execPath, ['services/crossfire/scripts/generate-sqlite-model.mjs', '--check'], 'canonical model drift check');
  await command(process.execPath, ['services/crossfire/scripts/generate-rest-catalog.mjs', '--check'], 'canonical REST catalog drift check');
  await command(process.execPath, ['services/fleetd/scripts/generate-rest-catalog.mjs', '--check'], 'canonical daemon REST catalog drift check');
  await command(dotnet, ['build', 'Ctlflow.CSharp.slnx', '-c', 'Release'], 'managed solution build');
  const storageProject = 'services/fleetd/csharp/tests/Fleetd.Storage.Tests';
  await command(dotnet, ['run', '--project', storageProject, '-c', 'Release', '--no-build'], 'managed fleetd authentication storage');
  const storagePublish = join(directory, 'native-storage');
  await command(dotnet, ['publish', storageProject, '-c', 'Release', '-r', 'linux-x64', '-p:PublishAot=true', '-p:CppCompilerAndLinker=gcc', '-o', storagePublish], 'NativeAOT fleetd storage publication');
  await command(join(storagePublish, 'Fleetd.Storage.Tests'), [], 'NativeAOT fleetd authentication storage');
  const controllerProject = 'services/fleetd/csharp/tests/Fleetd.Domain.Tests';
  await command(dotnet, ['run', '--project', controllerProject, '-c', 'Release', '--no-build'], 'managed controller ownership transitions');
  const controllerPublish = join(directory, 'native-controller');
  await command(dotnet, ['publish', controllerProject, '-c', 'Release', '-r', 'linux-x64', '-p:PublishAot=true', '-p:CppCompilerAndLinker=gcc', '-o', controllerPublish], 'NativeAOT controller ownership publication');
  await command(join(controllerPublish, 'Fleetd.Domain.Tests'), [], 'NativeAOT controller ownership transitions');
  const project = 'services/crossfire/csharp/tests/Crossfire.Storage.Tests';
  const managedDatabase = join(directory, 'managed.sqlite');
  await migrateDatabase(managedDatabase);
  await command(dotnet, ['run', '--project', project, '-c', 'Release', '--no-build', '--', managedDatabase], 'managed core acceptance');
  const managedServer = join(directory, 'managed-server');
  await command(dotnet, ['publish', 'services/crossfire/csharp/apps/Crossfire.Server', '-c', 'Release', '-p:PublishAot=false',
    '--self-contained', 'false', '-o', managedServer], 'managed production publication');
  const tools = readdirSync(managedServer, { recursive: true }).filter(name => /(^|\/)(Crossfire\.Ef|Microsoft\.CodeAnalysis|Microsoft\.Build|Microsoft\.EntityFrameworkCore\.(Design|Tasks)|BuildHost-)/u.test(name));
  if (tools.length) throw new Error('Production output contains build-only tools: ' + tools.join(', '));
  events.push({ label: 'production build-tool exclusion', code: 0, forbiddenArtifacts: tools.length });
  await command(dotnet, ['publish', project, '-c', 'Release', '-r', 'linux-x64', '-p:PublishAot=true', '-p:CppCompilerAndLinker=gcc', '-o', publish], 'NativeAOT publish');
  const nativeDatabase = join(directory, 'native.sqlite');
  await migrateDatabase(nativeDatabase);
  await command(join(publish, 'Crossfire.Storage.Tests'), [nativeDatabase], 'NativeAOT core acceptance');
  await command(process.execPath, ['services/crossfire/csharp/tests/calendar-parity.mjs', join(publish, 'Crossfire.Storage.Tests'),
    join(root, project, 'bin/Release/net11.0/Crossfire.Storage.Tests.dll'), dotnet], 'calendar differential parity');
  await command(process.execPath, ['services/crossfire/csharp/tests/state-lock-parity.mjs', join(publish, 'Crossfire.Storage.Tests'),
    join(root, project, 'bin/Release/net11.0/Crossfire.Storage.Tests.dll'), dotnet], 'cross-process state ownership parity');
  await command(process.execPath, [join(service, 'csharp/tests/matrix-parity.mjs'), join(publish, 'Crossfire.Storage.Tests'),
    join(root, project, 'bin/Release/net11.0/Crossfire.Storage.Tests.dll'), dotnet], 'managed and NativeAOT actual Conduit authority', service);
  await command(process.execPath, ['services/crossfire/csharp/tests/sqlite-parity.mjs', join(publish, 'Crossfire.Storage.Tests'),
    join(root, project, 'bin/Release/net11.0/Crossfire.Storage.Tests.dll'), dotnet], 'same-file SQLite interchange');
  await command(process.execPath, ['services/crossfire/csharp/tests/schema-parity.mjs', join(publish, 'Crossfire.Storage.Tests'),
    join(root, project, 'bin/Release/net11.0/Crossfire.Storage.Tests.dll'), dotnet], 'current schema constraints, validation and backup parity');
  console.log(JSON.stringify({ scope: 'implemented C# core, not full product parity', status: 'passed', resources, events }));
} finally {
  delete process.env.CROSSFIRE_TLS_TEST_ORIGIN;
  for (const dispose of disposers.toReversed()) await dispose();
  writeFileSync(join(temporaryRoot, 'csharp-core-summary.json'), JSON.stringify({ resources, events }, null, 2) + '\n', { mode: 0o600 });
  rmSync(directory, { recursive: true });
}
