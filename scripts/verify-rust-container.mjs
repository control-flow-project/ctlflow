import { accessSync, constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { command, repository } from './build.mjs';
import { withDockerTestResources } from './docker-test-resources.mjs';
import { userManagerEnvironment } from './test-resources.mjs';

const [distribution] = process.argv.slice(2);
if (process.argv.length !== 3 || !isAbsolute(distribution)) throw new Error('Supply one prepared Rust distribution directory');
accessSync(join(distribution, 'crossfire/crossfire'), constants.X_OK);
await withDockerTestResources(parent => command('systemd-run', ['--user', '--scope', '--quiet', '--slice=' + parent,
  '--setenv=CROSSFIRE_TEST_CGROUP_PARENT=' + parent, '--setenv=CROSSFIRE_RUST_DISTRIBUTION=' + distribution,
  process.execPath, '--test', '--test-reporter=spec', 'scripts/rust-container-worker.mjs'], repository, userManagerEnvironment(process.env)));
