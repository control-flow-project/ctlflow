import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export function validateContractMatrix(configuration) {
  if (!configuration || configuration.schemaVersion !== 1 || Object.keys(configuration).sort().join(',') !== 'schemaVersion,targets' || !Array.isArray(configuration.targets) || configuration.targets.length < 1 || configuration.targets.length > 16) throw new Error('Use schemaVersion 1 with an explicit nonempty implementation matrix');
  const names = new Set(), implementations = new Set();
  for (const target of configuration.targets) {
    if (!target || Object.keys(target).sort().join(',') !== 'cli,daemon,implementation,name,server' || !/^[a-z][a-z0-9-]{0,63}$/u.test(target.name) || names.has(target.name) || !['node', 'csharp', 'rust'].includes(target.implementation)) throw new Error('Invalid or duplicate implementation target');
    names.add(target.name); implementations.add(target.implementation);
    for (const product of ['server', 'daemon', 'cli']) {
      const value = target[product];
      if (!value || Object.keys(value).sort().join(',') !== 'arguments,binary' || typeof value.binary !== 'string' || !isAbsolute(value.binary) || !Array.isArray(value.arguments) || value.arguments.some(item => typeof item !== 'string' || item.includes('\0'))) throw new Error('Use an explicit executable/argument vector for ' + target.name + '/' + product);
      accessSync(value.binary, constants.X_OK);
    }
  }
  if (!implementations.has('node')) throw new Error('Include the Node reference for direct same-file interoperability');
  if (implementations.has('csharp') && (!configuration.targets.some(target => target.name === 'csharp-managed' && target.implementation === 'csharp') || !configuration.targets.some(target => target.name === 'csharp-nativeaot' && target.implementation === 'csharp'))) throw new Error('C# verification requires both managed and actual NativeAOT targets');
  return configuration.targets;
}

export function readContractMatrix(file) {
  if (typeof file !== 'string' || !isAbsolute(file) || statSync(file).size > 1048576) throw new Error('Supply one absolute, bounded implementation matrix JSON file');
  return validateContractMatrix(JSON.parse(readFileSync(file, 'utf8')));
}
