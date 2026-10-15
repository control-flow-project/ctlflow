import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onboardingGuide, setupDescriptorUrl } from '@ctlflow/crossfire-contracts/onboarding';
import { ARTIFACTS } from '@ctlflow/crossfire-contracts/release';
import { spawnSync } from 'node:child_process';

assert(process.argv.length === 2 || process.argv.length === 3 && process.argv[2] === '--check', 'Use --check or print the canonical native onboarding presentation');
const origin = 'https://rust-origin-template.invalid';
const owner = '@rust-owner-template:rust-owner-template.invalid';
const version = '333333.222222.111111';
const release = { version, release: version + '-' + '0'.repeat(24), artifacts: Object.fromEntries(ARTIFACTS.map(name => [name, {bytes:1,sha256:'0'.repeat(64)}])) };
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const candidates = [[quote(setupDescriptorUrl(origin, owner)), 'Descriptor'], [origin,'Origin'], [owner,'Owner'], [version,'Version']];
let guide = onboardingGuide(origin,owner,release);
const parts = [];
while (guide) {
  const next = candidates.map(([value,kind]) => ({value,kind,index:guide.indexOf(value)})).filter(value => value.index >= 0).sort((first,second) => first.index - second.index || second.value.length - first.value.length)[0];
  if (!next) {parts.push('Part::Text(' + JSON.stringify(guide) + ')'); break;}
  if (next.index) parts.push('Part::Text(' + JSON.stringify(guide.slice(0,next.index)) + ')');
  parts.push('Part::' + next.kind); guide = guide.slice(next.index + next.value.length);
}
const source = 'pub enum Part { Text(&\'static str), Origin, Owner, Version, Descriptor }\npub const GUIDE: &[Part] = &[\n' + parts.map(part => '    ' + part + ',').join('\n') + '\n];\n';
const formatted = spawnSync('rustfmt',['--edition','2024','--emit','stdout'],{input:source,encoding:'utf8',maxBuffer:1024*1024});
assert.equal(formatted.status,0,'Generated onboarding source must format');
if (process.argv[2] === '--check') assert.equal(readFileSync(new URL('../rust/packages/contracts/src/onboarding/guide.rs',import.meta.url),'utf8'),formatted.stdout,'Native onboarding guidance differs from the shared contract owner');
else process.stdout.write(formatted.stdout);
