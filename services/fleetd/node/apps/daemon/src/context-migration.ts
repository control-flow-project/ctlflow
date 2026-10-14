import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { acquireProcessLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { paths } from '@ctlflow/crossfire-adapter-filesystem/project';
import { migrateCodexContexts } from '@ctlflow/crossfire-adapter-codex/context-migration';
import { createRegistry } from '@ctlflow/fleetd-storage/registry';
import { failureError } from '@ctlflow/crossfire-kernel/result';

export async function migrateControllerContexts(root: string) {
  const release = await acquireProcessLock(join(root, 'daemon'));
  const locks: (() => Promise<void>)[] = [];
  try {
    const registry = createRegistry(root), registrations = registry.registrations();
    if (!registrations.ok) throw failureError(registrations.error);
    const inputs: { workspace: string; stateDirectory: string }[] = [];
    for (const registration of registrations.value) {
      const loaded = registry.load(registration.directory);
      if (!loaded.ok) throw failureError(loaded.error);
      for (const instance of loaded.value.roster.instances) {
        if (loaded.value.definitions[instance.definition]!.runtime !== 'codex') continue;
        const stateDirectory = join(registration.directory, instance.workarea);
        if (!existsSync(stateDirectory)) continue;
        const local = paths(stateDirectory, instance.key);
        for (const name of ['listener', 'receiver']) locks.push(await acquireProcessLock(join(local.state, name)));
        inputs.push({ workspace: instance.workspace ?? stateDirectory, stateDirectory });
      }
    }
    let migrated = 0, contexts = 0;
    for (const input of inputs) {
      const result = await migrateCodexContexts(input);
      if (!result.ok) throw failureError(result.error);
      migrated += Number(result.value.migrated); contexts += result.value.contexts;
    }
    return { status: 'migrated', inspected: inputs.length, migrated, contexts };
  } finally { try { for (const unlock of locks.reverse()) await unlock(); } finally { await release(); } }
}
