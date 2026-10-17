import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { permissionCatalog } from '@ctlflow/crossfire-domain/authorization/catalog';
import { spawnSync } from 'node:child_process';

const destination = new URL('../rust/packages/contracts/src/operations/', import.meta.url);
const definitions = Object.entries(operations);
const variant = value => value.split(/[.\-_]/u).map(part => part[0].toUpperCase() + part.slice(1)).join('');
const enumValue = value => value[0].toUpperCase() + value.slice(1).toLowerCase();
const groups = new Map(['identity', 'fleet', 'agent', 'runtime', 'wake', 'publication'].map(name => [name, []]));
const groupFor = operation => {
  if (operation.path.includes('publication')) return 'publication';
  if (operation.path.includes('wake-rule') || operation.path.includes('wake-deliver')) return 'wake';
  if (operation.path.includes('runtime') || operation.path.includes('native-stop')) return 'runtime';
  if (operation.path.includes('/fleets') || operation.path.includes('/enrollment')) return 'fleet';
  if (operation.path.includes('/agents') || operation.path.includes('/rooms')) return 'agent';
  return 'identity';
};
const permissions = new Set(permissionCatalog.map(item => item.code));
for (const [name, operation] of definitions) {
  if (operation.permissions.some(code => !permissions.has(code))) throw new Error('Unknown operation permission');
  groups.get(groupFor(operation)).push([name, operation]);
}
const publish = (name, contents) => {
  const formatted = spawnSync('rustfmt', ['--edition', '2024', '--emit', 'stdout'], { input: contents, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (formatted.status !== 0) throw new Error('Cannot format the generated Rust operation metadata');
  const path = new URL(`${name}.rs`, destination);
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== formatted.stdout) throw new Error('Rust operation metadata has drifted');
  } else {
    mkdirSync(destination, { recursive: true });
    writeFileSync(path, formatted.stdout);
  }
};
for (const [group, entries] of groups) {
  const metadata = entries.map(([name, operation]) => `    Operation { id: OperationId::${variant(name)}, name: ${JSON.stringify(name)}, method: Method::${enumValue(operation.method)}, path: ${JSON.stringify(operation.path)}, auth: Authentication::${enumValue(operation.auth)}, status: ${operation.status}, collection: ${operation.collection}, request_bytes: ${operation.requestBytes ?? 2 * 1024 * 1024}, binary: ${operation.requestFormat === 'binary'}, permissions: &[${operation.permissions.map(code => `Permission::${variant(code)}`).join(', ')}] },`).join('\n');
  publish(group, `use super::{Operation, OperationId, Method, Authentication};\n${entries.some(([, value]) => value.permissions.length) ? 'use crossfire_domain::permission::Permission;\n' : ''}\npub const OPERATIONS: &[Operation] = &[\n${metadata}\n];\n`);
}
publish('mod', `use crossfire_domain::permission::Permission;
${[...groups.keys()].map(group => `mod ${group};`).join('\n')}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method { Get, Post, Put, Patch, Delete }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Authentication { Public, Human, Agent, Either, Fleet, Controller }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationId {
${definitions.map(([name]) => `    ${variant(name)},`).join('\n')}
}

#[derive(Debug)]
pub struct Operation<Id = OperationId> {
    pub id: Id,
    pub name: &'static str,
    pub method: Method,
    pub path: &'static str,
    pub auth: Authentication,
    pub status: u16,
    pub collection: bool,
    pub request_bytes: usize,
    pub binary: bool,
    pub permissions: &'static [Permission],
}

pub fn operations() -> impl Iterator<Item = &'static Operation> + Clone {
    [${[...groups.keys()].map(group => `${group}::OPERATIONS`).join(',')}].into_iter().flatten()
}
`);
process.stdout.write(JSON.stringify({ operations: definitions.length, mode: process.argv.includes('--check') ? 'check' : 'generate' }) + '\n');
