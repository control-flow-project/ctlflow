import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { conduitFixture } from '../../dist/scripts/architecture-proof/conduit-fixture.js';
import { prepareConduitAssets } from '../../dist/scripts/architecture-proof/conduit-assets.js';
import { verifyTestResources } from '../../../../scripts/test-resources.mjs';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { migrateDatabase } from '@ctlflow/crossfire-data/management/sqlite/configuration';
import { artifactHash, releaseHash } from '@ctlflow/crossfire-adapter-filesystem/release';
import { ARTIFACTS } from '@ctlflow/crossfire-contracts/release';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { onboardingCommand, onboardingGuide, setupDescriptor } from '@ctlflow/crossfire-contracts/onboarding';

const [nativeBinary, managedAssembly, dotnetBinary] = process.argv.slice(2);
assert(nativeBinary && managedAssembly && dotnetBinary && process.argv.length === 5, 'Provide both implemented C# outputs');
const service = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.cwd(), service, 'Native Matrix verification runs in its service root');
verifyTestResources();
prepareConduitAssets();

for (const native of [false, true]) test((native ? 'NativeAOT' : 'Managed') + ' Matrix authority with actual pinned Conduit', { timeout: 60000 }, async context => {
  const jwtSecret = randomBytes(32).toString('hex');
  const conduit = await conduitFixture(context, { jwtSecret });
  const owner = await conduit.register('native-owner');
  const outsider = await conduit.register('native-outsider');
  const directory = mkdtempSync(join(service, '.temp/csharp-matrix-')); chmodSync(directory, 0o700);
  cleanup(context, () => rmSync(directory, { recursive: true }));
  const configuration = join(directory, 'native.json');
  const database = join(directory, 'management.sqlite');
  await migrateDatabase(database);
  const releaseDirectory = join(directory, 'release'); mkdirSync(releaseDirectory);
  const files = Object.fromEntries(ARTIFACTS.map(name => [name, Buffer.from('Native HTTP acceptance fixture: ' + name + '\n')]));
  const manifest = { version: '0.1.20', release: '0.1.20-' + releaseHash(files),
    artifacts: Object.fromEntries(ARTIFACTS.map(name => [name, { bytes: files[name].length, sha256: artifactHash(files[name]) }])) };
  for (const name of ARTIFACTS) writeFileSync(join(releaseDirectory, name), files[name]);
  writeFileSync(join(releaseDirectory, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(configuration, JSON.stringify({ origin: conduit.base, serverName: 'architecture.localhost', jwtSecret,
    registrationSecret: conduit.registrationToken, owner: owner.id, ownerToken: owner.token,
    outsider: outsider.id, agent: '@native-specialist:architecture.localhost', database, releaseDirectory }), { mode: 0o600 });
  const binary = native ? nativeBinary : dotnetBinary;
  const arguments_ = [...(native ? [] : [managedAssembly]), '--matrix', configuration];
  let output = '', errors = '';
  const child = spawn(binary, arguments_, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', bytes => { output = (output + bytes.toString('utf8')).slice(-65536); });
  child.stderr.on('data', bytes => { errors = (errors + bytes.toString('utf8')).slice(-65536); });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 45000);
  try {
    const code = await new Promise((complete, reject) => { child.once('error', reject); child.once('close', complete); });
    assert.equal(code, 0, errors + output);
    const result = JSON.parse(output.trim());
    assert.equal(result.Status, 'passed'); assert.equal(result.DynamicCode, !native);
    assert(result.Assertions >= 35, 'Complete native authority acceptance');
    const samples = JSON.parse(readFileSync(join(releaseDirectory, 'http-samples.json'), 'utf8'));
    assert(samples.length >= 10, 'C# HTTP acceptance produces canonical successful response samples');
    for (const sample of samples) {
      const operation = operations[sample.operation]; assert(operation, 'Known canonical operation ' + sample.operation);
      assert.equal(sample.status, operation.status, sample.operation + ' canonical status');
      const checked = operation.output(sample.data);
      assert.equal(checked.ok, true, sample.operation + ': ' + (checked.ok ? '' : checked.error.message));
    }
    for (const sample of JSON.parse(readFileSync(join(releaseDirectory, 'protocol-samples.json'), 'utf8'))) {
      const release = { version: sample.version };
      assert.equal(sample.command, onboardingCommand(sample.origin, sample.owner, release), 'Onboarding command has exact cross-language quoting');
      assert.equal(sample.guide, onboardingGuide(sample.origin, sample.owner, release, sample.instructions), 'One onboarding contract in both implementations');
      assert.deepEqual(sample.descriptor, setupDescriptor(sample.origin, sample.owner, release, sample.instructions));
    }
    context.diagnostic(JSON.stringify(result));
  } finally { clearTimeout(timeout); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});
