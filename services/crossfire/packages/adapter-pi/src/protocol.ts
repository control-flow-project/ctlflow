import * as check from '@crossfire/contracts/schema/validation';
import { deliveryText } from '@crossfire/adapter-runtime/journal';
import { success, failure } from '@crossfire/kernel/result';

const softwareHash: check.Parser<string> = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
  ? success(value) : failure('invalid', 'Invalid Pi native software hash');

export const piDescriptor = check.object({ version: check.choice('pi-0.99'), session: check.identifier, generation: check.identifier, software: softwareHash,
  workspace: check.text(4096), endpoint: check.text(100), token: check.secret });
export type PiDescriptor = check.Parsed<typeof piDescriptor>;
export const piBoundary = check.object({ leaf: check.nullable(check.text(200)) });
export const piRequest = check.object({ session: check.identifier, generation: check.identifier,
  method: check.choice('verify', 'boundary', 'publish', 'received', 'cancel', 'active', 'interrupt'),
  messageId: check.optional(check.text(200)), text: check.optional(deliveryText), boundary: check.optional(piBoundary), turn: check.optional(check.text(200)), recovery: check.optional(check.boolean) });
export type PiRequest = check.Parsed<typeof piRequest>;

export async function piCall(descriptor: PiDescriptor, request: Omit<PiRequest, 'session' | 'generation'>, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const url = new URL(descriptor.endpoint);
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || url.username || url.password || !url.port
    || url.pathname !== '/' || url.search || url.hash) throw new Error('Pi native connection must stay on authenticated loopback');
  let response: Response;
  try {
    response = await fetch(descriptor.endpoint, { method: 'POST', redirect: 'error', headers: { authorization: 'Bearer ' + descriptor.token, 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, session: descriptor.session, generation: descriptor.generation }), signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
  } catch (cause) { throw new Error('Pi native session connection closed or is unavailable', { cause }); }
  if (!response.ok) throw new Error('Pi native attachment rejected the operation: HTTP ' + response.status);
  if (!response.body) throw new Error('Missing Pi native response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 4096) throw new Error('Pi native response exceeds its bound');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
}
