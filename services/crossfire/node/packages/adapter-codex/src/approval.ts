import { fields, object, text } from '@ctlflow/crossfire-contracts/validation';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Json } from '@ctlflow/crossfire-kernel/json';
import type { RuntimeDecision } from '@ctlflow/crossfire-agent-core/runtime';
import type { NativeRequest } from './protocol.js';

const choices = new Map<string, string>([
  ['accept', 'approve once'], ['acceptForSession', 'approve session'], ['decline', 'deny'], ['cancel', 'cancel turn'],
]);

export function permissionDenial(permission: RuntimeDecision): Json | undefined {
  const choice = permission.choices.find(choice => {
    const value = object(choice.value);
    return value.ok && (value.value.decision === 'decline' || value.value.decision === 'cancel');
  });
  return choice === undefined ? undefined : structuredClone(choice.value);
}

function nativeText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= maximum && !value.includes('\0');
}

function decision(value: unknown): Result<{ label: string; value: Json }> {
  if (typeof value === 'string' && choices.has(value)) return success({ label: choices.get(value)!, value: { decision: value } });
  const parsed = object(value);
  if (!parsed.ok || Object.keys(parsed.value).length !== 1) return failure('invalid', 'Unsupported native permission decision');
  const amendment = parsed.value.acceptWithExecpolicyAmendment;
  if (amendment !== undefined) {
    const contents = fields(amendment, ['execpolicy_amendment']);
    const command = contents.ok ? contents.value.execpolicy_amendment : undefined;
    if (Array.isArray(command) && command.length > 0
      && command.length <= 100 && command.every(part => text(part, 4096))) {
      return success({ label: 'apply command rule', value: { decision: value as Json } });
    }
  }
  const network = parsed.value.applyNetworkPolicyAmendment;
  if (network !== undefined) {
    const contents = fields(network, ['network_policy_amendment']);
    const rule = contents.ok ? fields(contents.value.network_policy_amendment, ['host', 'action']) : contents;
    if (rule.ok && text(rule.value.host, 255) && ['allow', 'deny'].includes(String(rule.value.action))) {
      return success({ label: rule.value.action === 'allow' ? 'allow network rule' : 'deny network rule', value: { decision: value as Json } });
    }
  }
  return failure('invalid', 'Invalid native permission amendment');
}

export function codexPermission(request: NativeRequest, session: string, fileChanges?: Json): Result<RuntimeDecision> {
  const params = request.params;
  if (params.threadId !== session || !text(params.turnId, 255) || !text(params.itemId, 255)
    || typeof request.id !== 'string' && !Number.isSafeInteger(request.id)) return failure('invalid', 'RuntimeDecision belongs to an invalid native session');
  let available: unknown[];
  let action: string;
  let scope: Json;
  if (request.method === 'item/commandExecution/requestApproval') {
    if (!nativeText(params.command, 8 * 1024 * 1024) || !text(params.cwd, 4096) || !Array.isArray(params.availableDecisions)) {
      return failure('invalid', 'Native command approval needs its exact command, workspace and available decisions');
    }
    available = params.availableDecisions;
    action = 'command execution';
    scope = JSON.parse(JSON.stringify(params)) as Json;
  } else if (request.method === 'item/fileChange/requestApproval') {
    if (!Array.isArray(fileChanges) || !fileChanges.length || fileChanges.some(change => {
      const parsed = object(change);
      return !parsed.ok || !text(parsed.value.path, 4096) || typeof parsed.value.diff !== 'string';
    })) return failure('invalid', 'Native file approval needs the exact pending paths and changes');
    available = ['accept', 'acceptForSession', 'decline', 'cancel'];
    action = 'file changes';
    scope = { request: JSON.parse(JSON.stringify(params)) as Json, changes: structuredClone(fileChanges) };
  } else return failure('invalid', 'Unsupported native permission request');
  if (!available.length || available.length > 16) return failure('invalid', 'Invalid native permission choice count');
  const decoded: RuntimeDecision['choices'] = [];
  for (const value of available) {
    const choice = decision(value);
    if (!choice.ok) return choice;
    if (decoded.some(previous => previous.label === choice.value.label)) return failure('invalid', 'Duplicate native permission choices');
    decoded.push(choice.value);
  }
  return success({ runtime: 'codex', session, request: JSON.stringify([typeof request.id, request.id]), action, scope, choices: decoded,
    turn: params.turnId as string, item: params.itemId as string, blocking: true, expiresMs: null });
}
