import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { privateDir } from '@ctlflow/crossfire-adapter-filesystem/index';
import { nativeJson } from '@ctlflow/crossfire-adapter-runtime/native-file';
import { object } from '@ctlflow/crossfire-contracts/validation';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';

export function instructionCapability(value: unknown): Result<void> {
  const schema = object(value), definitions = schema.ok ? object(schema.value.definitions) : schema;
  const params = definitions.ok ? object(definitions.value.ThreadInjectItemsParams) : definitions;
  const properties = params.ok ? object(params.value.properties) : params;
  const items = properties.ok ? object(properties.value.items) : properties;
  const threadId = properties.ok ? object(properties.value.threadId) : properties;
  const required = params.ok ? params.value.required : null;
  if (!schema.ok || !params.ok || params.value.type !== 'object' || !items.ok || items.value.type !== 'array' || !threadId.ok || threadId.value.type !== 'string'
    || !Array.isArray(required) || !['items', 'threadId'].every(key => required.includes(key)) || !Array.isArray(schema.value.oneOf)
    || !schema.value.oneOf.some(value => {
      const method = object(value), fields = method.ok ? object(method.value.properties) : method;
      const name = fields.ok ? object(fields.value.method) : fields, input = fields.ok ? object(fields.value.params) : fields;
      return name.ok && input.ok && Array.isArray(name.value.enum) && name.value.enum.length === 1
        && name.value.enum[0] === 'thread/inject_items' && input.value.$ref === '#/definitions/ThreadInjectItemsParams';
    })) return failure('native', 'Install a native Codex release supporting experimental thread/inject_items developer instructions, then repeat fleet setup');
  return success(undefined);
}

export async function inspectInstructionCapability(binary: string, home: string, workspace: string, environment: NodeJS.ProcessEnv, stop: AbortSignal): Promise<Result<void>> {
  stop.throwIfAborted();
  const directory = mkdtempSync(join(privateDir(home), '.crossfire-protocol-'));
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(binary, ['app-server', 'generate-json-schema', '--out', directory, '--experimental'],
        { cwd: workspace, env: environment, timeout: 10000, maxBuffer: 65536, signal: stop }, error => {
          if (error) reject(new Error('Cannot inspect native Codex developer-instruction capability; install a supported Codex release and repeat fleet setup'));
          else resolve();
        });
    });
    stop.throwIfAborted();
    return instructionCapability(nativeJson(join(directory, 'ClientRequest.json'), 2 * 1024 * 1024));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
