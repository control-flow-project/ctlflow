import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { HTTP_LIMITS } from '@ctlflow/crossfire-contracts/rest/limits';

if (process.argv.length > 3 || process.argv[2] !== undefined && process.argv[2] !== '--check') throw new Error('Use --check or print the canonical C# REST catalog');
const lines = [
  '#nullable enable', 'using System.Text.Json;', '', 'namespace Crossfire.Contracts;', '',
  'public sealed record RestOperation(string Name, string Method, string Path, string Authentication, int Status, bool Collection, int MaximumBodyBytes, bool Binary);', '',
  'public sealed record RestCall(string Operation, IReadOnlyDictionary<string, string> Parameters, JsonElement? Body = null, IReadOnlyDictionary<string, string>? Query = null);', '',
  'public static class RestOperations', '{',
  '    public static readonly IReadOnlyDictionary<string, RestOperation> All = new Dictionary<string, RestOperation>(StringComparer.Ordinal)', '    {'
];
for (const [name, operation] of Object.entries(operations)) lines.push('        [' + JSON.stringify(name) + '] = new(' + [name, operation.method, operation.path, operation.auth].map(JSON.stringify).join(', ')
  + ', ' + operation.status + ', ' + operation.collection + ', ' + (operation.requestBytes ?? 2097152) + ', ' + (operation.requestFormat === 'binary') + '),');
lines.push('    };', '}', '', 'public static class HttpLimits', '{');
for (const [name, value] of Object.entries(HTTP_LIMITS)) lines.push('    public const int ' + name[0].toUpperCase() + name.slice(1) + ' = ' + value + ';');
lines.push('}', '');
const generated = lines.join('\n');
if (process.argv[2] === '--check') {
  const target = fileURLToPath(new URL('../csharp/packages/Crossfire.Contracts/RestOperations.g.cs', import.meta.url));
  if (readFileSync(target, 'utf8') !== generated) throw new Error('C# REST catalog differs from the canonical operation contract');
} else process.stdout.write(generated);
