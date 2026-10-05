import { command, repository } from './build.mjs';
import { withDockerTestResources } from './docker-test-resources.mjs';

await withDockerTestResources(parent => command('systemd-run', ['--user', '--scope', '--quiet', '--slice=' + parent,
  '--setenv=CROSSFIRE_TEST_CGROUP_PARENT=' + parent, 'npm', 'run', 'verify:container', '--workspace=@ctlflow/crossfire'], repository));
