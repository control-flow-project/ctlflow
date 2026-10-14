import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { loggingRetentionDays } from '@ctlflow/crossfire-kernel/logging';
import { failure, success } from '@ctlflow/crossfire-kernel/result';

export function readLoggingConfiguration(root: string) {
  try {
    const file = join(root, 'config.json');
    const input = lstatSync(file, { throwIfNoEntry: false }) ? readJson<unknown>(file) : {};
    const parsed = check.object({ loggingRetentionDays: check.optional(loggingRetentionDays) })(input);
    if (!parsed.ok) return parsed;
    const days = loggingRetentionDays(parsed.value.loggingRetentionDays);
    return days.ok ? success({ loggingRetentionDays: days.value }) : days;
  } catch { return failure('invalid', 'Controller logging configuration must be an owned private valid JSON file'); }
}
