import type { Json } from '@ctlflow/crossfire-contracts/json';
import type { NativeEvent } from './protocol.js';

type ThreadStatus = { type: 'idle' | 'notLoaded' | 'systemError' }
  | { type: 'active'; activeFlags: ('waitingOnApproval' | 'waitingOnUserInput')[] };
type Item = { type: 'agentMessage'; id: string; text: string }
  | { type: 'commandExecution'; id: string; command: string; cwd: string; aggregatedOutput: string | null }
  | { type: 'fileChange'; id: string; changes: Json }
  | { type: 'mcpToolCall'; id: string; tool: string; result: Json; error: Json }
  | { type: 'dynamicToolCall'; id: string; tool: string; contentItems: Json[] | null; success: boolean | null }
  | { type: 'webSearch'; id: string; query: string; action: Json; results: Json[] | null }
  | { type: 'imageGeneration'; id: string; status: string; revisedPrompt: string | null; result: string; failure: Json };
export type ObservedEvent = { method: 'thread/status/changed'; status: ThreadStatus }
  | { method: 'turn/started' }
  | { method: 'turn/completed'; status: 'completed' | 'failed' | 'interrupted'; errorMessage: string | null }
  | { method: 'item/started' | 'item/completed'; item: Item }
  | { method: 'item/agentMessage/delta' | 'item/commandExecution/outputDelta'; itemId: string; delta: string }
  | { method: 'item/mcpToolCall/progress'; itemId: string; message: string };

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid native observation object');
  return input as Record<string, unknown>;
}
function text(input: unknown): string {
  if (typeof input !== 'string') throw new Error('Invalid native observation text');
  return input;
}
function nullableText(input: unknown): string | null { return input === null ? null : text(input); }
function json(input: unknown): Json {
  if (input === null || typeof input === 'string' || typeof input === 'boolean' || typeof input === 'number' && Number.isFinite(input)) return input;
  if (Array.isArray(input)) return input.map(json);
  return Object.fromEntries(Object.entries(object(input)).map(([key, value]) => [key, json(value)]));
}
function array(input: unknown): Json[] | null {
  if (input === null) return null;
  if (!Array.isArray(input)) throw new Error('Invalid native observation array');
  return input.map(json);
}
function item(input: unknown): Item | null {
  const value = object(input), type = value.type;
  if (!['agentMessage', 'commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'imageGeneration'].includes(String(type))) return null;
  const id = text(value.id);
  if (!id) throw new Error('Native observation requires an exact item identity');
  switch (type) {
    case 'agentMessage': return { type, id, text: text(value.text) };
    case 'commandExecution': return { type, id, command: text(value.command), cwd: text(value.cwd), aggregatedOutput: nullableText(value.aggregatedOutput) };
    case 'fileChange': return { type, id, changes: json(value.changes) };
    case 'mcpToolCall': return { type, id, tool: text(value.tool), result: json(value.result), error: json(value.error) };
    case 'dynamicToolCall':
      if (value.success !== null && typeof value.success !== 'boolean') throw new Error('Invalid native tool success state');
      return { type, id, tool: text(value.tool), contentItems: array(value.contentItems), success: value.success };
    case 'webSearch': return { type, id, query: text(value.query), action: json(value.action), results: array(value.results) };
    case 'imageGeneration': return { type, id, status: text(value.status), revisedPrompt: nullableText(value.revisedPrompt), result: text(value.result), failure: json(value.failure) };
  }
  throw new Error('Invalid native observation item');
}

export function observedEvent(event: NativeEvent): ObservedEvent | null {
  const { method, params } = event;
  switch (method) {
    case 'thread/status/changed': {
      const status = object(params.status);
      if (status.type === 'active') {
        if (!Array.isArray(status.activeFlags) || !status.activeFlags.every(flag => flag === 'waitingOnApproval' || flag === 'waitingOnUserInput')) throw new Error('Invalid native thread activity flags');
        return { method, status: { type: status.type, activeFlags: status.activeFlags } };
      }
      if (status.type !== 'idle' && status.type !== 'notLoaded' && status.type !== 'systemError') throw new Error('Invalid native thread activity state');
      return { method, status: { type: status.type } };
    }
    case 'turn/started': return { method };
    case 'turn/completed': {
      const turn = object(params.turn);
      if (turn.status !== 'completed' && turn.status !== 'failed' && turn.status !== 'interrupted') throw new Error('Invalid native turn completion state');
      return { method, status: turn.status, errorMessage: turn.error === null ? null : text(object(turn.error).message) };
    }
    case 'item/started':
    case 'item/completed': {
      const observed = item(params.item);
      return observed ? { method, item: observed } : null;
    }
    case 'item/agentMessage/delta':
    case 'item/commandExecution/outputDelta': return { method, itemId: text(params.itemId), delta: text(params.delta) };
    case 'item/mcpToolCall/progress': return { method, itemId: text(params.itemId), message: text(params.message) };
    default: return null;
  }
}
