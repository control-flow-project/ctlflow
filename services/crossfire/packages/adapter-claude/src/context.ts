import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { realpathSync, readSync } from 'node:fs';
import { UUID } from '@crossfire/contracts/client';
import { object } from '@crossfire/contracts/validation';
import { nativeJson, ownedFile } from '@crossfire/adapter-runtime/native-file';

export const CLAUDE_VERSION = '2.1.285';
export type ClaudeContext = { session: string; workspace: string; registry: string; pid: number; birth: string; socket: string; token: string; transcript: string };

function verifyProcess(pid: number, birth: string): void {
  ownedFile('/proc/' + pid + '/stat', 4096, descriptor => {
    const bytes = Buffer.alloc(4096);
    const length = readSync(descriptor, bytes, 0, bytes.length, 0);
    if (!length || length === bytes.length) throw new Error('Invalid native Claude process identity');
    const record = bytes.subarray(0, length).toString();
    const fields = record.slice(record.lastIndexOf(') ') + 2).split(' ');
    if (fields[19] !== birth || ['Z', 'X'].includes(fields[0]!)) throw new Error('The native Claude process exited or its PID was reused');
  });
}

function supportedVersion(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/u.test(value)) return false;
  const [major, minor, patch] = value.split('.').map(Number);
  return major! > 2 || major === 2 && (minor! > 1 || minor === 1 && patch! >= 285);
}

export function nativeClaude(environment: NodeJS.ProcessEnv, workspace: string) {
  const session = environment.CLAUDE_CODE_SESSION_ID;
  const pid = Number(environment.CLAUDE_PID);
  const socket = environment.CLAUDE_CODE_MESSAGING_SOCKET;
  const token = environment.CLAUDE_CODE_MESSAGING_TOKEN;
  if (!session || !UUID.test(session) || !Number.isSafeInteger(pid) || pid < 1 || !socket || !isAbsolute(socket)
    || !token || token.length > 4096 || /\s/u.test(token)) throw new Error('Run connect inside Claude Code 2.1.285+; its native tool environment must supply the exact session and private peer connection');
  const registry = join(environment.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'sessions', String(pid) + '.json');
  const metadata = object(nativeJson(registry));
  if (!metadata.ok) throw new Error('Invalid native Claude session registry');
  const value = metadata.value;
  if (value.pid !== pid || value.sessionId !== session || typeof value.cwd !== 'string' || realpathSync(value.cwd) !== realpathSync(workspace)
    || value.messagingSocketPath !== socket || value.peerProtocol !== 1 || typeof value.procStart !== 'string'
    || !supportedVersion(value.version)) {
    throw new Error('Claude session, workspace or native peer protocol does not match the supported attachment');
  }
  verifyProcess(pid, value.procStart);
  return { session, workspace: realpathSync(workspace), registry, pid, birth: value.procStart, socket, token };
}

export function verifyClaude(context: ClaudeContext): { busy: boolean } {
  verifyProcess(context.pid, context.birth);
  const metadata = object(nativeJson(context.registry));
  if (!metadata.ok || metadata.value.pid !== context.pid || metadata.value.sessionId !== context.session || metadata.value.procStart !== context.birth
    || metadata.value.messagingSocketPath !== context.socket || typeof metadata.value.cwd !== 'string'
    || realpathSync(metadata.value.cwd) !== context.workspace) throw new Error('The native Claude attachment closed or switched; reconnect in the selected session');
  return { busy: metadata.value.status === 'busy' };
}
