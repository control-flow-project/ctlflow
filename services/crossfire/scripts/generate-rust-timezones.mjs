import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { prepareTimezones } from './timezones.mjs';
if (process.argv.length !== 3 || process.argv[2] !== '--check') throw new Error('Use --check to verify the native IANA catalogue');
const {version,zones:ordered}=JSON.parse(readFileSync(join(await prepareTimezones(),'catalogue.json'),'utf8'));
if (version !== process.versions.tz) throw new Error('Node and native implementations require the same pinned IANA data');
const table = 'pub const VERSION: &str = "' + version + '";\npub const ZONES: &[(&str, &str)] = &[\n'
    + ordered.map(([name, target]) => '    (' + JSON.stringify(name) + ', ' + JSON.stringify(target) + '),').join('\n') + '\n];\n';
const formatted = spawnSync('rustfmt', ['--edition', '2024', '--emit', 'stdout'], {input:table, encoding:'utf8', maxBuffer:1048576});
if (formatted.status !== 0 || readFileSync(new URL('../rust/packages/adapter-schedule/src/zones.rs', import.meta.url), 'utf8') !== formatted.stdout) throw new Error('Native IANA catalogue has drifted');
process.stdout.write(JSON.stringify({version, zones:ordered.length, status:'passed'}) + '\n');
