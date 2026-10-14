import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTestResources } from '../../../../scripts/test-resources.mjs';
import { nativeModels } from '@ctlflow/crossfire-test-support/native-models';
import { preparePi, piBinary } from '@ctlflow/crossfire-test-support/pi';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const temporary = join(root, 'services/crossfire/.temp');
if (process.argv.length !== 2) throw new Error('Runtime verification takes no optional suite or runtime flags');
const resources = verifyTestResources(); mkdirSync(temporary, { recursive: true, mode: 0o700 });
const directory = mkdtempSync(join(temporary, 'csharp-runtime-'));
const project = join(root, 'services/crossfire/csharp/tests/Crossfire.Runtime.Tests');
const dotnet = process.env.DOTNET_EXECUTABLE ?? 'dotnet'; const events = [];
const catalog = join(directory, 'models.json'); writeFileSync(catalog, JSON.stringify(nativeModels()), { mode: 0o600 });

async function run(binary, arguments_, label) {
  const started = performance.now();
  const result = await new Promise((complete, reject) => {
    const child = spawn(binary, arguments_, { cwd: root, stdio: 'inherit', env: { ...process.env,
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
      DOTNET_CLI_DO_NOT_USE_MSBUILD_SERVER: '1', MSBUILDDISABLENODEREUSE: '1', UseSharedCompilation: 'false',
      CROSSFIRE_TEST_MODEL_CATALOG: catalog, CROSSFIRE_TEST_PI_EXECUTABLE: piBinary() } });
    child.once('error', reject); child.once('exit', (code, signal) => complete({ code, signal }));
  });
  events.push({ label, elapsedMs: Math.round(performance.now() - started), ...result });
  if (result.code !== 0) throw new Error(label + ' failed: ' + (result.signal ?? result.code));
}

try {
  preparePi();
  await run(process.execPath, ['services/crossfire/scripts/generate-native-pi-extension.mjs', '--check'], 'shared native Pi extension drift check');
  await run(dotnet, ['run', '--project', project, '-c', 'Release'], 'managed native transport');
  const publish = join(directory, 'native');
  await run(dotnet, ['publish', project, '-c', 'Release', '-r', 'linux-x64', '-p:PublishAot=true', '-p:CppCompilerAndLinker=gcc', '-o', publish], 'NativeAOT runtime publish');
  await run(join(publish, 'Crossfire.Runtime.Tests'), [], 'NativeAOT native transport');
  console.log(JSON.stringify({ scope: 'implemented runtime adapters, not full fleet parity', status: 'passed', resources, events }));
} finally {
  writeFileSync(join(temporary, 'csharp-runtime-summary.json'), JSON.stringify({ resources, events }, null, 2) + '\n', { mode: 0o600 });
  rmSync(directory, { recursive: true });
}
