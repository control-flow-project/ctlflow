import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { availableParallelism } from 'node:os';
import test from 'node:test';
import { readContractMatrix } from './contract-targets.mjs';
import { buildProducts, command, products, repository } from './build.mjs';
import { verifyTestResources } from './test-resources.mjs';

assert(process.argv.length === 4 && process.argv.slice(2).every(isAbsolute), 'Use verify-performance.mjs /absolute/implementation-matrix.json /absolute/new-report-directory');
const targets = readContractMatrix(process.argv[2]), output = resolve(process.argv[3]);
assert(!existsSync(output), 'Performance output must be a new directory');
const resources = verifyTestResources();
await buildProducts(products);
await command(process.execPath, ['--test', 'dist/tests/performance/fixture.test.js', 'dist/tests/performance/report.test.js', 'dist/tests/performance/report-browser.test.js', 'dist/tests/performance/transport.test.js'], join(repository, 'services/crossfire'));
await command(process.execPath, ['dist/scripts/architecture-proof/conduit-assets.js'], join(repository, 'services/crossfire'));
const { serverPerformance } = await import('../services/crossfire/dist/tests/performance/server.js');
process.chdir(join(repository, 'services/crossfire'));
const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
test('crossfire Node, .NET and Rust performance parity', { timeout: 900000 }, scope => serverPerformance(scope, targets, output, {
  source: { commit: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain', '--untracked-files=normal']) !== '' },
  host: { platform: process.platform, architecture: process.arch, processors: availableParallelism(), resources },
}));
