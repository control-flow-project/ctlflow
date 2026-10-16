import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { implementationApplications, implementationPackages } from './verify-implementation-layout.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sharedPackages = {
  'agent-tools': ['intentional tool/library asset shared by all native targets', 'services/crossfire/node/packages/agent-tools'],
  'operator-support': ['shared optional operator library; no native backend fallback', 'services/crossfire/node/packages/operator-support'],
  'test-support': ['shared executable-contract fixture; native internal fixtures remain target-owned', 'services/crossfire/tests/contracts'],
};
export function fileOwner(file) {
  const [, product, language, layer, name] = file.split('/');
  assert(product in implementationApplications && ['node', 'csharp'].includes(language));
  const base = `services/${product}/rust`;
  if (layer === 'apps') return ['application', `${base}/apps/${implementationApplications[product].rust}`];
  if (layer === 'packages') {
    if (language === 'node' && product === 'crossfire' && name in sharedPackages) return sharedPackages[name];
    const pairs = Object.entries(implementationPackages[product]);
    const pair = pairs.find(([node, csharp]) => language === 'node' ? node === name : csharp === name);
    const role = pair ? pair[0] === 'client' ? 'adapter-http' : pair[0] :
      product === 'crossfire' && language === 'csharp' && ['Crossfire.AdapterProcess', 'Crossfire.AdapterToml'].includes(name)
        ? name === 'Crossfire.AdapterProcess' ? 'adapter-process' : 'adapter-toml' : null;
    assert(role, 'Every package requires an explicit semantic owner: ' + file);
    return ['native library', `${base}/packages/${role}`];
  }
  if (layer === 'build') return ['EF design-time generation; Diesel has no EF compiler', 'services/crossfire/scripts/generate-rust-schema.mjs'];
  if (layer === 'tests') return ['target-internal test; public behavior uses one common assertion bank', `services/${product}/tests/contracts`];
  if (layer === 'scripts') return ['target build/verification; native equivalent uses workspace coordinators', product === 'crossfire' ? 'scripts/verify-rust.mjs' : 'scripts/publish-rust.mjs'];
  if (layer === 'tools') return ['shared optional operator CLI; no duplicated native implementation', `services/${product}/node/tools`];
  if (layer === 'Dockerfile') return ['native container definition', `${base}/Dockerfile`];
  if (layer === 'README.md') return ['implementation guide', product === 'crossfire' ? `${base}/README.md` : `services/${product}/README.md`];
  assert(language === 'node' && /^tsconfig(?:\.[a-z-]+)?\.json$/u.test(layer), 'Unclassified file: ' + file);
  return ['target compiler configuration', 'Cargo.toml'];
}
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'dist', 'bin', 'obj', 'target', '.temp'].includes(entry.name)) return [];
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? files(path) : [relative(root, path).split('\\').join('/')];
  });
}
export function inventory() {
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'services'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  const deleted = new Set(execFileSync('git', ['ls-files', '--deleted', '--', 'services'], { cwd: root, encoding: 'utf8' }).trim().split('\n'));
  const selected = [...new Set(tracked.filter(file => !deleted.has(file) && /^services\/(crossfire|fleetd|fleet)\/(node|csharp)\//u.test(file)))].sort();
  const rows = selected.map(file => {
    const bytes = readFileSync(resolve(root, file));
    const [disposition, counterpart] = fileOwner(file);
    assert(existsSync(resolve(root, counterpart)), 'Missing counterpart: ' + file + ' -> ' + counterpart);
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const symbols = [...source.matchAll(/\b(?:export\s+(?:(?:async|declare|abstract)\s+)?(?:function|class|interface|type|const)|public\s+(?:(?:static|async|sealed|partial|readonly|abstract|override|virtual)\s+)*(?:class|record|interface|enum|(?:[\w?.<>\[\],]+\s+)))\s*(\w+)/gu)].map(match => match[1]);
    return { file, bytes: bytes.length, lines: source.split('\n').length, sha256: createHash('sha256').update(bytes).digest('hex'), counterpart, disposition, symbols: [...new Set(symbols)] };
  });
  const rust = Object.keys(implementationApplications).flatMap(product => files(resolve(root, `services/${product}/rust`)));
  assert(rows.length && rust.length);
  const totals = {};
  for (const row of rows) { const key = row.file.split('/').slice(1, 3).join('/'); totals[key] = (totals[key] ?? 0) + 1; }
  return { schemaVersion: 1, basis: 'Per-file ownership, content identity and declaration inventory; not behavioral certification or a substitute for source review/tests', baseline: execFileSync('git', ['rev-parse', 'origin/main'], { cwd: root, encoding: 'utf8' }).trim(), totals, rustFiles: rust.length, files: rows };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'The inventory accepts no source filtering or skipped files');
  process.stdout.write(JSON.stringify(inventory(), null, 2) + '\n');
}
