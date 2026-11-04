import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stageMigrations } from './stage-migrations.mjs';

test('maintenance staging retains Knex and its validator without service executables or first-party runtime links', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'ctlflow-maintenance-'));
  const root = join(temporary, 'source'), output = join(temporary, 'output');
  try {
    for (const directory of ['node_modules/@ctlflow', 'node_modules/knex', 'services/crossfire/database/management/sqlite/migrations', 'services/crossfire/dist']) mkdirSync(join(root, directory), { recursive: true });
    for (const name of ['package.json', '.npmrc', 'LICENSE', 'services/crossfire/knexfile.management.mjs', 'services/crossfire/dist/container-configuration.mjs', 'services/crossfire/database/management/sqlite/migrations/00_initial.mjs', 'node_modules/knex/package.json']) writeFileSync(join(root, name), name);
    symlinkSync('../../services/crossfire/database', join(root, 'node_modules/@ctlflow/crossfire-data'));
    symlinkSync('../../services/fleet', join(root, 'node_modules/@ctlflow/fleet'));
    symlinkSync('../../services/fleetd', join(root, 'node_modules/@ctlflow/fleetd'));
    stageMigrations(root, output);
    assert.equal(readlinkSync(join(output, 'node_modules/@ctlflow/crossfire-data')), '../../services/crossfire/database');
    assert.equal(existsSync(join(output, 'node_modules/@ctlflow/fleet')), false);
    assert.equal(existsSync(join(output, 'node_modules/@ctlflow/fleetd')), false);
    assert.equal(readFileSync(join(output, 'services/crossfire/database/management/sqlite/migrations/00_initial.mjs'), 'utf8'), 'services/crossfire/database/management/sqlite/migrations/00_initial.mjs');
    assert.equal(existsSync(join(output, 'node_modules/knex/package.json')), true);
    assert.equal(existsSync(join(output, 'services/crossfire/dist/container-configuration.mjs')), true);
    assert.equal(existsSync(join(output, 'services/crossfire/apps')), false);
    assert.throws(() => stageMigrations(root, output), /new absolute/u);
    assert.throws(() => stageMigrations(root, 'relative'), /new absolute/u);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
