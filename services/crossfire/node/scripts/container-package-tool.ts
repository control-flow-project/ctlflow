import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { packageImageIdentities, prepareContainerPackage, readContainerPackage } from '../apps/server/src/container-package.js';
import { exportContainerPackage } from './container-packages.js';

if (Number(process.versions.node.split('.')[0]) < 26) throw new Error('Container build tools require Node.js 26+');
const [action, ...arguments_] = process.argv.slice(2);
if (action === 'verify') {
  if (arguments_.length !== 1 || !isAbsolute(arguments_[0]!)) throw new Error('Use package-tool.mjs verify /absolute/package-directory');
  console.log(JSON.stringify(await prepareContainerPackage(arguments_[0]!, new AbortController().signal)));
} else if (action === 'identities') {
  if (arguments_.length !== 1 || !isAbsolute(arguments_[0]!)) throw new Error('Use package-tool.mjs identities /absolute/package-directory with Docker inspection JSON on stdin');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of process.stdin as AsyncIterable<unknown>) {
    if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string') throw new Error('Invalid container image inspection stream');
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length;
    if (size > 1048576) throw new Error('Container image inspection exceeds its metadata bound');
    chunks.push(bytes);
  }
  const identities = packageImageIdentities(readContainerPackage(arguments_[0]!), JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
  console.log(identities.runtimeImage + ' ' + identities.migrationImage);
} else if (action === 'export') {
  const { values, positionals } = parseArgs({ args: arguments_, options: { runtime: { type: 'string' }, migrations: { type: 'string' }, output: { type: 'string' } }, allowPositionals: true });
  if (positionals.length || !values.runtime || !values.migrations || !values.output) throw new Error('Use package-tool.mjs export --runtime sha256:ID --migrations sha256:ID --output /absolute/new-package');
  await exportContainerPackage(values.runtime, values.migrations, values.output, readFileSync(fileURLToPath(import.meta.url)));
} else throw new Error('Use package-tool.mjs verify, identities or export');
