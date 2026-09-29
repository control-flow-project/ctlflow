import { discoverCodex } from '../../../packages/adapter-codex/src/discovery.js';

const adapters = { codex: discoverCodex };
export function discoverRuntime(name: string, workspace: string) {
  if (name !== 'codex') throw new Error('Supported runtime adapter: codex');
  return adapters[name](workspace);
}
