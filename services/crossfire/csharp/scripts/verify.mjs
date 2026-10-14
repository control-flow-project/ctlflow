import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTestResources } from '../../../../scripts/test-resources.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const service = join(root, 'services/crossfire');
const dotnet = process.env.DOTNET_EXECUTABLE ?? 'dotnet';
if (process.argv.length !== 2) throw new Error('Core C# verification takes no optional runtime or suite flags');
const resources = verifyTestResources();
const temporaryRoot = join(service, '.temp'); mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
const directory = mkdtempSync(join(temporaryRoot, 'csharp-core-'));
const publish = join(directory, 'native');
const events = [];

async function command(binary, arguments_, label) {
  const start = performance.now();
  const result = await new Promise((complete, reject) => {
    const child = spawn(binary, arguments_, { cwd: root, stdio: 'inherit', env: { ...process.env,
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false' } });
    child.once('error', reject); child.once('exit', (code, signal) => complete({ code, signal }));
  });
  events.push({ label, elapsedMs: Math.round(performance.now() - start), ...result });
  if (result.code !== 0) throw new Error(label + ' failed: ' + (result.signal ?? result.code));
}

try {
  await command(process.execPath, ['services/crossfire/scripts/generate-sqlite-model.mjs', '--check'], 'canonical model drift check');
  await command(dotnet, ['build', 'Crossfire.CSharp.slnx', '-c', 'Release'], 'managed solution build');
  const project = 'services/crossfire/csharp/tests/Crossfire.Storage.Tests';
  await command(dotnet, ['run', '--project', project, '-c', 'Release', '--no-build'], 'managed core acceptance');
  await command(dotnet, ['publish', project, '-c', 'Release', '-r', 'linux-x64', '-p:PublishAot=true', '-p:CppCompilerAndLinker=gcc', '-o', publish], 'NativeAOT publish');
  await command(join(publish, 'Crossfire.Storage.Tests'), [], 'NativeAOT core acceptance');
  await command(process.execPath, ['services/crossfire/csharp/tests/sqlite-parity.mjs', join(publish, 'Crossfire.Storage.Tests'),
    join(root, project, 'bin/Release/net11.0/Crossfire.Storage.Tests.dll'), dotnet], 'same-file SQLite parity and forward migration');
  console.log(JSON.stringify({ scope: 'implemented C# core, not full product parity', status: 'passed', resources, events }));
} finally {
  writeFileSync(join(temporaryRoot, 'csharp-core-summary.json'), JSON.stringify({ resources, events }, null, 2) + '\n', { mode: 0o600 });
  rmSync(directory, { recursive: true });
}
