import { captureDocker, containerNames, runDocker } from './container-commands.js';

export async function ownedDocker(args: string[], signal: AbortSignal): Promise<void> {
  if (args[0] !== 'run' || !args.includes('--name') || args.some(value => value === '--rm' || value.startsWith('--rm='))) throw new Error('Use the explicit owned-container command without automatic removal');
  signal.throwIfAborted();
  const created = await captureDocker(['create', ...args.slice(1)]);
  if (created.code !== 0) throw new Error('Cannot create the owned container: ' + created.errors);
  const identity = created.output.trim(); if (!/^[a-f0-9]{64}$/u.test(identity)) throw new Error('Docker did not return an exact container identity');
  const attachment = new AbortController(); let running: Promise<void> | undefined, failure: unknown;
  let cancelled: (() => void) | undefined;
  try {
    signal.throwIfAborted(); running = runDocker(['start', '--attach', identity], attachment.signal);
    const stopped = new Promise<boolean>(resolveStop => { cancelled = () => resolveStop(true); signal.addEventListener('abort', cancelled, { once: true }); if (signal.aborted) cancelled(); });
    if (await Promise.race([running.then(() => false), stopped])) {
      try { await runDocker(['stop', '--timeout', '15', identity], AbortSignal.timeout(30000)); }
      finally { attachment.abort(); }
    }
    await running;
  } catch (error) { failure = error; }
  finally {
    if (cancelled) signal.removeEventListener('abort', cancelled); attachment.abort();
    if (running) try { await running; } catch (error) { failure ??= error; }
    try { await removeContainer(identity); }
    catch (error) { failure = new Error('Owned container cleanup is not confirmed', { cause: failure ?? error }); }
  }
  if (failure !== undefined && !(signal.aborted && failure instanceof Error && failure.name === 'AbortError')) throw failure;
}

async function containerIds(filter: string, signal?: AbortSignal): Promise<string[]> {
  const result = await captureDocker(['container', 'ls', '--all', '--no-trunc', '--filter', filter, '--format', '{{.ID}}'], signal);
  if (result.code !== 0) throw new Error('Cannot establish existing container ownership: ' + result.errors);
  const identities = result.output.trim() ? result.output.trim().split('\n') : [];
  if (identities.some(identity => !/^[a-f0-9]{64}$/u.test(identity))) throw new Error('Docker returned an invalid container identity');
  return identities;
}

export async function removeContainer(identity: string, signal?: AbortSignal): Promise<void> {
  if (!/^[a-f0-9]{64}$/u.test(identity)) throw new Error('Cleanup requires an exact container identity');
  const stopped = await captureDocker(['stop', '--timeout', '15', identity], signal);
  if (stopped.code !== 0 && (await containerIds('id=' + identity, signal)).length) throw new Error('Owned container stop is not confirmed: ' + stopped.errors);
  const removed = await captureDocker(['rm', identity], signal);
  if ((await containerIds('id=' + identity, signal)).length) throw new Error('Owned container cleanup is not confirmed: ' + removed.errors);
}

export async function reconcileContainers(directory: string, signal: AbortSignal): Promise<void> {
  const owned: string[] = [];
  for (const name of Object.values(containerNames(directory))) {
    const identities = await containerIds('name=^/' + name + '$', signal);
    if (identities.length > 1) throw new Error('Docker returned ambiguous instance container ownership');
    for (const identity of identities) {
      const inspection = await captureDocker(['container', 'inspect', '--format', '{{.Id}}\n{{json .Config.Labels}}', identity], signal);
      if (inspection.code !== 0) throw new Error('Cannot verify existing container ownership: ' + inspection.errors);
      const [actual, labels] = inspection.output.trim().split('\n');
      const parsed: unknown = JSON.parse(labels ?? 'null');
      if (actual !== identity || parsed === null || typeof parsed !== 'object' || !('org.crossfire.directory' in parsed)
        || parsed['org.crossfire.directory'] !== directory) throw new Error('Existing container has different ownership; nothing was stopped');
      owned.push(identity);
    }
  }
  for (const identity of owned) await removeContainer(identity, signal);
}
