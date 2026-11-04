import { options, textOption, inputFile, runTool, saveReport, type Options } from '@ctlflow/crossfire-operator-support/command';
import { fingerprintPlan, verifyFingerprints } from '@ctlflow/crossfire-operator-support/files';
import { verifySource } from '@ctlflow/crossfire-operator-support/process';
import { failure, type Result } from '@ctlflow/crossfire-kernel/result';
import { credentials } from './auth.js';
import { verifyRelease } from './release.js';
import { inspectDatabase, databaseExpectations, verifyPreservation } from './database.js';
import { verifyServer, serverExpectations } from './server.js';
import { hostPlan, verifyHost, verifyArchive } from './host.js';
import { enrollmentPlan, reviewEnrollment } from './enrollment.js';
import { fleetWakePlan, reviewFleetWake } from './fleet-wake.js';
import { loggingRetentionDays } from '@ctlflow/crossfire-kernel/logging';

const usage = `crossfire operator tools (run after npm run build)
release --origin URL --release-directory PATH [--web-directory PATH]
server --origin URL --credentials PATH [--expect PATH]
browser --origin URL --credentials PATH --browser PATH --evidence PATH
content --url URL --main-origin URL --browser PATH --evidence PATH
database --file PATH [--expect PATH] [--schema]
preservation --before PATH --after PATH [--logging-retention-days DAYS --retention-at UTC_ISO]
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
    content: ['url', 'main-origin', 'browser', 'evidence'], database: ['file'], preservation: ['before', 'after'], files: ['plan'], archive: ['file', 'sha256'], source: ['directory'], host: ['plan'], enrollment: ['origin', 'credentials', 'plan'], 'fleet-wake': ['origin', 'credentials', 'plan'] };
  if (!command || !Object.hasOwn(required, command)) return failure('invalid', usage);
  const extra: Record<string, string[]> = { release: ['web-directory'], server: ['expect'], database: ['expect'], source: ['revision', 'tree'], preservation: ['logging-retention-days', 'retention-at'] };
  const parsed = options(args, required[command]!, [...(extra[command] ?? []), 'output'], command === 'database' ? ['schema'] : ['enrollment', 'fleet-wake'].includes(command) ? ['execute'] : []);
  if (!parsed.ok) return parsed;
  return saveReport(await selected(command, parsed.value, signal), parsed.value);
}

async function selected(command: string, values: Options, signal: AbortSignal): Promise<Result<unknown>> {
  const text = (name: string) => textOption(values, name)!;
  if (command === 'content') {
    const { verifyContent } = await import('./browser/content.js');
    return verifyContent(text('url'), text('main-origin'), text('browser'), text('evidence'), signal);
  }
  if (command === 'release') return verifyRelease(text('origin'), text('release-directory'), textOption(values, 'web-directory'), signal);
  if (command === 'files') { const plan = inputFile(text('plan'), fingerprintPlan); return plan.ok ? verifyFingerprints(plan.value) : plan; }
  if (command === 'source') return verifySource(text('directory'), textOption(values, 'revision'), textOption(values, 'tree'), signal);
  if (command === 'archive') return verifyArchive(text('file'), text('sha256'), signal);
  if (command === 'preservation') {
    const retention = textOption(values, 'logging-retention-days'), at = textOption(values, 'retention-at');
    if (retention === undefined && at === undefined) return verifyPreservation(text('before'), text('after'));
    if (retention === undefined || at === undefined || !/^[1-9][0-9]*$/u.test(retention)) return failure('invalid', 'Supply retention days and the exact cleanup UTC timestamp together');
    const days = loggingRetentionDays(Number(retention)); if (!days.ok) return days;
    const time = Date.parse(at);
    if (!Number.isSafeInteger(time) || time < 0 || new Date(time).toISOString() !== at) return failure('invalid', 'Use a canonical UTC ISO retention timestamp');
    return verifyPreservation(text('before'), text('after'), { loggingRetentionDays: days.value, at: time });
  }
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
