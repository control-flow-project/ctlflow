import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repository } from './build.mjs';

// The only Node runtime image is the one-shot Knex maintenance job.
export function stageMigrations(root, output) {
  if (!isAbsolute(output) || existsSync(output)) throw new Error('Use a new absolute migration staging directory');
  mkdirSync(output);
  for (const file of ['package.json', '.npmrc', 'LICENSE']) cpSync(join(root, file), join(output, file));
  cpSync(join(root, 'node_modules'), join(output, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  const links = join(output, 'node_modules/@ctlflow');
  for (const entry of readdirSync(links)) {
    if (!lstatSync(join(links, entry)).isSymbolicLink()) throw new Error('First-party modules must have one workspace owner');
    if (entry !== 'crossfire-data') rmSync(join(links, entry));
  }
  const service = join(output, 'services/crossfire');
  mkdirSync(service, { recursive: true });
  cpSync(join(root, 'services/crossfire/database'), join(service, 'database'), { recursive: true });
  mkdirSync(join(service, 'dist'), { recursive: true });
  cpSync(join(root, 'services/crossfire/dist/container-configuration.mjs'), join(service, 'dist/container-configuration.mjs'));
  cpSync(join(root, 'services/crossfire/knexfile.management.mjs'), join(service, 'knexfile.management.mjs'));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Use stage-migrations.mjs /absolute/new-directory');
  stageMigrations(repository, process.argv[2]);
}
