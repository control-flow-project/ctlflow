import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const resourceNames = ['memory.max', 'memory.swap.max', 'pids.max'];

export function resourceLimits(group, root, read = file => readFileSync(file, 'utf8')) {
  const directory = resolve(group), boundary = resolve(root);
  if (relative(boundary, directory).startsWith('..') || isAbsolute(relative(boundary, directory))) throw new Error('Resource scope is outside the cgroup filesystem');
  const effective = {};
  for (let current = directory; ; current = dirname(current)) {
    for (const key of resourceNames) {
      let text;
      try { text = read(join(current, key)).trim(); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (text === 'max') continue;
      if (!/^\d+$/u.test(text)) throw new Error('Invalid cgroup resource limit: ' + key);
      const value = BigInt(text);
      if (effective[key] === undefined || value < effective[key]) effective[key] = value;
    }
    if (current === boundary) break;
  }
  for (const key of resourceNames) {
    if (effective[key] === undefined || effective[key] === 0n && key !== 'memory.swap.max') throw new Error('Test process group lacks a verified finite ' + key + ' limit');
  }
  return Object.fromEntries(Object.entries(effective).map(([key, value]) => [key, value.toString()]));
}

export function verifyTestResources() {
  if (process.platform !== 'linux') throw new Error('Verified aggregate test process-group limits require Linux cgroup v2; no unbounded runtime fallback is permitted');
  const matched = /^0::(\/[^\n]*)$/mu.exec(readFileSync('/proc/self/cgroup', 'utf8'));
  if (!matched) throw new Error('Tests require a verified unified cgroup resource scope');
  try { return resourceLimits(join('/sys/fs/cgroup', matched[1]), '/sys/fs/cgroup'); }
  catch (error) {
    throw new Error(error.message + '. Run the command in an operator-sized transient process-group scope with finite memory, swap and task limits and an absolute checkout path.', { cause: error });
  }
}
