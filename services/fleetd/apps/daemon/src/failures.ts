import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readJson, writeJson } from '@crossfire/adapter-filesystem/index';
import { failureReport } from '@crossfire/contracts/runtime';
import * as check from '@crossfire/contracts/schema/validation';
import { operations } from '@crossfire/contracts/rest/operations';
import { createClient } from '@crossfire/adapter-crossfire/client';
import type { Binding } from '@fleetd/storage/binding';
import { failure, success } from '@crossfire/kernel/result';

export function failureReporter(directory: string, binding: Binding, signal: AbortSignal) {
  const file = join(directory, '.fleet', 'failures.json');
  const loaded = check.list(failureReport, 4096)(existsSync(file) ? readJson<unknown>(file, 32 * 1024 * 1024) : []);
  if (!loaded.ok) throw new Error(loaded.error.message);
  const reports = loaded.value;
  let errorMessage: string | null = null;
  const stop = new AbortController(), lifetime = AbortSignal.any([signal, stop.signal]);
  const client = createClient({ origin: binding.server, token: binding.controllerCredential!, signal: lifetime, timeoutMs: 5000 });
  const save = () => writeJson(file, reports, 32 * 1024 * 1024);
  const running = (async () => {
    while (!lifetime.aborted) {
      try {
        save();
        errorMessage = null;
        for (const report of [...reports]) {
          const result = await client.call(operations.reportFleetFailure, { fleetId: binding.fleetId! }, report);
          if (!result.ok) { errorMessage = result.error.message; break; }
          reports.splice(reports.indexOf(report), 1); save();
        }
      } catch (error) { errorMessage = error instanceof Error ? error.message : 'Failure journal unavailable'; }
      await delay(1000, undefined, { signal: lifetime });
    }
  })().catch(error => { if (!lifetime.aborted) errorMessage = error instanceof Error ? error.message : 'Failure reporter unavailable'; });
  return {
    error: () => errorMessage,
    record(agentId: string, sessionId: string | null, error: unknown) {
      const report = failureReport({ episodeId: randomUUID(), agentId, sessionId,
        message: (error instanceof Error ? error.message : 'Runtime or listener ended unexpectedly').slice(0, 4000) });
      if (!report.ok) return report;
      if (reports.length >= 4096) { errorMessage = 'Resolve queued failure reports before starting further native work'; return failure('limit', errorMessage); }
      reports.push(report.value);
      try { save(); return success(undefined); }
      catch (error) { errorMessage = error instanceof Error ? error.message : 'Cannot persist the failure report'; return failure('unavailable', errorMessage); }
    },
    async close() { stop.abort(); await running; },
  };
}
