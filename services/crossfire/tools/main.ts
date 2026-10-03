import { options, textOption, inputFile, runTool, saveReport, type Options } from '@crossfire/operator-support/command';
import { fingerprintPlan, verifyFingerprints } from '@crossfire/operator-support/files';
import { verifySource } from '@crossfire/operator-support/process';
import { failure, type Result } from '@crossfire/kernel/result';
import { credentials } from './auth.js';
import { verifyRelease } from './release.js';
import { inspectDatabase, databaseExpectations, verifyPreservation } from './database.js';
import { verifyServer, serverExpectations } from './server.js';
import { hostPlan, verifyHost, verifyArchive } from './host.js';
import { enrollmentPlan, reviewEnrollment } from './enrollment.js';
import { fleetWakePlan, reviewFleetWake } from './fleet-wake.js';

const usage = `Crossfire operator tools (run after npm run build)
release --origin URL --release-directory PATH [--web-directory PATH]
server --origin URL --credentials PATH [--expect PATH]
browser --origin URL --credentials PATH --browser PATH --evidence PATH
database --file PATH [--expect PATH] [--schema]
preservation --before PATH --after PATH
files --plan PATH
archive --file PATH --sha256 HASH
source --directory PATH [--revision SHA] [--tree SHA]
host --plan PATH
enrollment --origin URL --credentials PATH --plan PATH [--execute]
fleet-wake --origin URL --credentials PATH --plan PATH [--execute]
Every command accepts --output PATH. Inputs/evidence containing credentials must be private.`;

export async function inspect(arguments_: string[], signal: AbortSignal): Promise<Result<unknown>> {
  const [command, ...args] = arguments_;
  const required: Record<string, string[]> = { release: ['origin', 'release-directory'], server: ['origin', 'credentials'], browser: ['origin', 'credentials', 'browser', 'evidence'],
    database: ['file'], preservation: ['before', 'after'], files: ['plan'], archive: ['file', 'sha256'], source: ['directory'], host: ['plan'], enrollment: ['origin', 'credentials', 'plan'], 'fleet-wake': ['origin', 'credentials', 'plan'] };
  if (!command || !Object.hasOwn(required, command)) return failure('invalid', usage);
  const extra: Record<string, string[]> = { release: ['web-directory'], server: ['expect'], database: ['expect'], source: ['revision', 'tree'] };
  const parsed = options(args, required[command]!, [...(extra[command] ?? []), 'output'], command === 'database' ? ['schema'] : ['enrollment', 'fleet-wake'].includes(command) ? ['execute'] : []);
  if (!parsed.ok) return parsed;
  return saveReport(await selected(command, parsed.value, signal), parsed.value);
}

async function selected(command: string, values: Options, signal: AbortSignal): Promise<Result<unknown>> {
  const text = (name: string) => textOption(values, name)!;
  if (command === 'release') return verifyRelease(text('origin'), text('release-directory'), textOption(values, 'web-directory'), signal);
  if (command === 'files') { const plan = inputFile(text('plan'), fingerprintPlan); return plan.ok ? verifyFingerprints(plan.value) : plan; }
  if (command === 'source') return verifySource(text('directory'), textOption(values, 'revision'), textOption(values, 'tree'), signal);
  if (command === 'archive') return verifyArchive(text('file'), text('sha256'), signal);
  if (command === 'preservation') return verifyPreservation(text('before'), text('after'));
  if (command === 'database') {
    const expected = values.expect ? inputFile(text('expect'), databaseExpectations) : databaseExpectations({});
    return expected.ok ? inspectDatabase(text('file'), expected.value, values.schema === true) : expected;
  }
  if (command === 'host') { const plan = inputFile(text('plan'), hostPlan); return plan.ok ? verifyHost(plan.value, signal) : plan; }
  const account = inputFile(text('credentials'), credentials); if (!account.ok) return account;
  if (command === 'enrollment') { const plan = inputFile(text('plan'), enrollmentPlan); return plan.ok ? reviewEnrollment(text('origin'), account.value, plan.value, values.execute === true, signal) : plan; }
  if (command === 'fleet-wake') { const plan = inputFile(text('plan'), fleetWakePlan); return plan.ok ? reviewFleetWake(text('origin'), account.value, plan.value, values.execute === true, signal) : plan; }
  if (command === 'browser') {
    const { verifyBrowser } = await import('./browser/verify.js');
    return verifyBrowser(text('origin'), account.value, text('browser'), text('evidence'), signal);
  }
  const expected = values.expect ? inputFile(text('expect'), serverExpectations) : serverExpectations({});
  return expected.ok ? verifyServer(text('origin'), account.value, expected.value, signal) : expected;
}

if (import.meta.main) {
  const arguments_ = process.argv.slice(2);
  if (!arguments_.length || arguments_[0] === '--help') process.stdout.write(usage + '\n');
  else await runTool(signal => inspect(arguments_, signal));
}
