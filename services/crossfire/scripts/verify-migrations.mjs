import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { withDockerTestResources } from '../../../scripts/docker-test-resources.mjs';
import { imageName, migrationImageName } from '../dist/apps/server/src/operator.js';
import { migrationArguments } from '../dist/apps/server/src/container-commands.js';
import { ownedDocker } from '../dist/apps/server/src/container-lifecycle.js';
import { openStore } from '@ctlflow/crossfire-adapter-sqlite/open-store';
import { schema13Store } from '../dist/tests/support/schema13.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const service = join(root, 'services/crossfire');
const temporary = join(service, '.temp'); mkdirSync(temporary, { recursive: true, mode: 0o700 });
const directory = mkdtempSync(join(temporary, 'migration-container-'));
const image = migrationImageName(imageName(root));
const outcomes = [];

try {
  await withDockerTestResources(async parent => {
    execFileSync('docker', ['build', '--cgroup-parent', parent, '--file', join(service, 'node/Dockerfile'), '--target', 'migrations', '--tag', image, root],
      { stdio: 'inherit', timeout: 1_800_000 });
    for (const version of [0, 13, 17, 18]) {
      const selected = join(directory, String(version)); mkdirSync(selected, { mode: 0o700 });
      const path = join(selected, 'management.sqlite');
      if (version !== 0) {
        const previous = schema13Store();
        try { writeFileSync(path, previous.serialize(), { mode: 0o600 }); } finally { previous.close(); }
      }
      if (version === 17) await ownedDocker(migrationArguments(selected, image, parent), AbortSignal.timeout(60000));
      if (version === 18) {
        const future = new Database(path); try { future.pragma('user_version=18'); } finally { future.close(); }
        await assert.rejects(() => ownedDocker(migrationArguments(selected, image, parent), AbortSignal.timeout(60000)),
          /Unsupported Crossfire schema/u);
        outcomes.push({ version, status: 'rejected' });
        continue;
      }
      await ownedDocker(migrationArguments(selected, image, parent), AbortSignal.timeout(60000));
      const database = openStore(path);
      try {
        assert.equal(database.pragma('user_version', { simple: true }), 17);
        assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
        assert.deepEqual(database.pragma('foreign_key_check'), []);
      } finally { database.close(); }
      outcomes.push({ version, status: 'passed' });
    }
  });
  console.log(JSON.stringify({ status: 'passed', scope: 'actual shared Knex migration container', image, outcomes }));
} finally { rmSync(directory, { recursive: true }); }
