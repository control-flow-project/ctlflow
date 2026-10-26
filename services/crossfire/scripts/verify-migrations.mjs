import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withDockerTestResources } from '../../../scripts/docker-test-resources.mjs';
import { containerSourceDigest } from '../dist/scripts/container-packages.js';
import { packageLabels } from '../dist/scripts/container-package.js';
import { openStore } from '@ctlflow/crossfire-adapter-sqlite/open-store';
import { databaseIdentity, foreignKeyViolations, integrityResult } from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const service = join(root, 'services/crossfire');
const temporary = join(service, '.temp'); mkdirSync(temporary, { recursive: true, mode: 0o700 });
const directory = mkdtempSync(join(temporary, 'migration-container-'));
const sourceDigest = containerSourceDigest(root);
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const labels = Object.entries(packageLabels({ version, sourceDigest }, 'migrations'))
  .flatMap(([key, value]) => ['--label', key + '=' + value]);
const tag = 'crossfire-migrations:' + sourceDigest.slice(0, 20);
let image;
const outcomes = [];

try {
  await withDockerTestResources(async parent => {
    execFileSync('docker', ['build', '--cgroup-parent', parent, '--file', join(service, 'node/Dockerfile'), '--target', 'migrations', '--tag', tag, ...labels, root],
      { stdio: 'inherit', timeout: 1_800_000 });
    image = execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', tag], { encoding: 'utf8', timeout: 30000 }).trim();
    assert.match(image, /^sha256:[a-f0-9]{64}$/u);
    execFileSync('docker', ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--cgroup-parent', parent, '--entrypoint', '/bin/sh', image, '-c',
      'test ! -e /usr/bin/g++ && test ! -d /app/services/crossfire/csharp && test ! -d /app/services/crossfire/node/tests && test ! -d /app/element && test ! -e /usr/local/bin/conduit'],
    { stdio: 'inherit', timeout: 30000 });
    const selected = join(directory, 'current'); mkdirSync(selected, { mode: 0o700 });
    const path = join(selected, 'management.sqlite');
    for (const phase of ['initialize', 'repeat']) {
      execFileSync('docker', ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--cgroup-parent', parent, '--memory', '2g', '--pids-limit', '512', '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m',
        '--mount', 'type=bind,source=' + selected + ',target=/runtime', image], { stdio: 'inherit', timeout: 60000 });
      const database = openStore(path);
      try {
        assert.equal(databaseIdentity(database).version, 1);
        assert.equal(integrityResult(database), 'ok');
        assert.deepEqual(foreignKeyViolations(database), []);
      } finally { database.close(); }
      outcomes.push({ phase, status: 'passed' });
    }
  });
  console.log(JSON.stringify({ status: 'passed', scope: 'actual shared Knex migration container', image, outcomes }));
} finally { rmSync(directory, { recursive: true }); }
