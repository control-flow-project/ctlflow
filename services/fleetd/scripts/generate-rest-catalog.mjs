import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { operations } from '@ctlflow/fleetd-contracts/api';

if (process.argv.length > 3 || process.argv[2] !== undefined && process.argv[2] !== '--check') throw new Error('Use --check or print the canonical C# daemon REST catalog');
const lines = ['using Crossfire.Contracts;', '', 'namespace Fleetd.Contracts;', '', 'public static class DaemonOperations', '{',
  '    public static readonly IReadOnlyDictionary<string, RestOperation> All = new Dictionary<string, RestOperation>(StringComparer.Ordinal)', '    {'];
for (const [name, operation] of Object.entries(operations)) lines.push('        [' + JSON.stringify(name) + '] = new(' + [name, operation.method, operation.path, operation.auth].map(JSON.stringify).join(', ')
  + ', ' + operation.status + ', ' + operation.collection + ', 1048576, false),');
lines.push('    };', '}', '');
const generated = lines.join('\n');
if (process.argv[2] === '--check') {
  const target = fileURLToPath(new URL('../csharp/packages/Fleetd.Contracts/DaemonOperations.g.cs', import.meta.url));
  if (readFileSync(target, 'utf8') !== generated) throw new Error('C# daemon REST catalog differs from the canonical operation contract');
} else process.stdout.write(generated);
