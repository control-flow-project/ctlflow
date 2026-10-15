import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (process.argv.length !== 3 || process.argv[2] !== '--check') throw new Error('Use --check to verify the native IANA catalogue');
const source = readFileSync('/usr/share/zoneinfo/tzdata.zi', 'utf8');
const version = /^# version (\S+)/u.exec(source)?.[1];
if (version !== process.versions.tz || version !== '2026c') throw new Error('Node and native implementations require the same pinned IANA 2026c data');
const names = new Map(), links = new Map();
for (const line of source.split('\n')) {
    const fields = line.split(/\s+/u);
    if (fields[0] === 'Z') names.set(fields[1], fields[1]);
    if (fields[0] === 'L') links.set(fields[2], fields[1]);
}
for (const [alias, target] of links) {
    let current = target; const seen = new Set([alias]);
    while (links.has(current)) { if (seen.has(current)) throw new Error('IANA link cycle'); seen.add(current); current = links.get(current); }
    if (!names.has(current)) throw new Error('Unknown IANA canonical link target');
    names.set(alias, current);
}
const ordered = [...names].sort((first, second) => first[0].toLowerCase() < second[0].toLowerCase() ? -1 : 1);
const table = 'pub const VERSION: &str = "' + version + '";\npub const ZONES: &[(&str, &str)] = &[\n'
    + ordered.map(([name, target]) => '    (' + JSON.stringify(name) + ', ' + JSON.stringify(target) + '),').join('\n') + '\n];\n';
const formatted = spawnSync('rustfmt', ['--edition', '2024', '--emit', 'stdout'], {input:table, encoding:'utf8', maxBuffer:1048576});
if (formatted.status !== 0 || readFileSync(new URL('../rust/packages/adapter-schedule/src/zones.rs', import.meta.url), 'utf8') !== formatted.stdout) throw new Error('Native IANA catalogue has drifted');
process.stdout.write(JSON.stringify({version, zones:ordered.length, status:'passed'}) + '\n');
