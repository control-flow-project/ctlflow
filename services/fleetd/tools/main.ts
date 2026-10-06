import { options, textOption, inputFile, runTool, saveReport } from '@ctlflow/crossfire-operator-support/command';
import { failure, type Result } from '@ctlflow/crossfire-kernel/result';
import { writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { verifyFleet, preservation } from './verify.js';

const usage = `fleetd operator tools (run after npm run build)
verify --root PATH --directory PATH [--running] [--fresh] [--no-rooms]
  [--skills NAME,NAME] [--preserve PATH] [--snapshot PATH] [--output PATH]
Read-only: no native turns, replies, approvals, room creation or lifecycle changes.
--snapshot writes only private account/history/provider-fingerprint preservation evidence.`;

export async function inspect(arguments_: string[], signal: AbortSignal): Promise<Result<unknown>> {
  if (arguments_[0] !== 'verify') return failure('invalid', usage);
  const parsed = options(arguments_.slice(1), ['root', 'directory'], ['skills', 'preserve', 'snapshot', 'output'], ['running', 'fresh', 'no-rooms']);
  if (!parsed.ok) return parsed;
  const values = parsed.value, skills = textOption(values, 'skills')?.split(',') ?? [];
  if (skills.some(name => !/^[a-z][a-z0-9-]{0,99}$/u.test(name)) || new Set(skills).size !== skills.length) return failure('invalid', 'Supply distinct project skill names');
  const previous = values.preserve ? inputFile(textOption(values, 'preserve')!, preservation) : undefined;
  if (previous && !previous.ok) return previous;
  const result = await verifyFleet({ root: textOption(values, 'root')!, directory: textOption(values, 'directory')!,
    running: values.running === true, fresh: values.fresh === true, noRooms: values['no-rooms'] === true, skills,
    ...(previous?.ok ? { previous: previous.value } : {}) }, signal);
  if (result.ok && values.snapshot && result.value && typeof result.value === 'object' && 'preservation' in result.value) writeJson(textOption(values, 'snapshot')!, result.value.preservation);
  return saveReport(result, values);
}

if (import.meta.main) {
  const arguments_ = process.argv.slice(2);
  if (!arguments_.length || arguments_[0] === '--help') process.stdout.write(usage + '\n');
  else await runTool(signal => inspect(arguments_, signal));
}
