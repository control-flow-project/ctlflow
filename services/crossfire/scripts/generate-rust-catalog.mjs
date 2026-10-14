import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { permissionCatalog } from '@ctlflow/crossfire-domain/authorization/catalog';

const destination = new URL('../rust/packages/domain/src/permission.rs', import.meta.url);
const variant = code => code.split(/[.\-_]/u).map(part => part[0].toUpperCase() + part.slice(1)).join('');
const variants = permissionCatalog.map(item => variant(item.code));
if (new Set(variants).size !== variants.length) throw new Error('Permission variants must be unique');
const text = `#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Permission {
${variants.map(name => `    ${name},`).join('\n')}
}

impl Permission {
    pub const ALL: &[Self] = &[${variants.map(name => `Self::${name}`).join(',')}];

    pub fn parse(code: &str) -> Option<Self> {
        match code {
${permissionCatalog.map(item => `            ${JSON.stringify(item.code)} => Some(Self::${variant(item.code)}),`).join('\n')}
            _ => None,
        }
    }

    pub const fn code(self) -> &'static str {
        match self {
${permissionCatalog.map(item => `            Self::${variant(item.code)} => ${JSON.stringify(item.code)},`).join('\n')}
        }
    }
}

impl std::fmt::Display for Permission {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code())
    }
}
`;
const formatted = spawnSync('rustfmt', ['--edition', '2024', '--emit', 'stdout'], {
  input: text, encoding: 'utf8', maxBuffer: 1024 * 1024,
});
if (formatted.status !== 0) throw new Error('Cannot format the generated Rust permission catalog');
if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== formatted.stdout) throw new Error('Rust permission catalog has drifted');
} else writeFileSync(destination, formatted.stdout);
process.stdout.write(JSON.stringify({ permissions: permissionCatalog.length, mode: process.argv.includes('--check') ? 'check' : 'generate' }) + '\n');
