import { failure, success } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import type { InstancePolicy } from '../audit/types.js';
import { authorize } from '../authorization/authorize.js';
import { recordEvent } from '../audit/record-event.js';
export function changeInstancePolicy(services: Pick<Services, 'repositories' | 'directory' | 'unitOfWork' | 'identity' | 'clock'>,
  actor: Actor, input: Omit<InstancePolicy, 'id' | 'revision'> & { expectedRevision: number }, requestId: string) {
  if (!Number.isSafeInteger(input.maxOwnerAgents) || input.maxOwnerAgents < 1 || input.maxOwnerAgents > 100
    || !Number.isSafeInteger(input.maxAgents) || input.maxAgents < input.maxOwnerAgents || input.maxAgents > 1000
    || !Number.isSafeInteger(input.maxPending) || input.maxPending < 1 || input.maxPending > 1000
    || !Number.isSafeInteger(input.enrollmentSeconds) || input.enrollmentSeconds < 60 || input.enrollmentSeconds > 3600
    || !Number.isSafeInteger(input.reconcileSeconds) || input.reconcileSeconds < 30 || input.reconcileSeconds > 3600
    || !Number.isSafeInteger(input.maxMessageBytes) || input.maxMessageBytes < 4096 || input.maxMessageBytes > 4 * 1024 * 1024
    || !Number.isSafeInteger(input.fleetIdleTimeoutSeconds) || input.fleetIdleTimeoutSeconds < 0 || input.fleetIdleTimeoutSeconds > 604800
    || !['invitation', 'open'].includes(input.signupMode) || !['administrators', 'members'].includes(input.invitationIssuers)
    || new TextEncoder().encode(input.agentInstructions).length > 8192
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.agentInstructions)) return failure('invalid', 'Invalid bounded instance policy');
  return services.unitOfWork.run(() => {
    const authority = authorize(services, actor, 'policy.manage');
    if (!authority.ok) return authority;
    const current = services.repositories.instancePolicy.find({ id: 'instance' });
    if (!current.ok) return current;
    if (!current.value || current.value.revision !== input.expectedRevision) return failure('conflict', 'Policy revision changed');
    const { expectedRevision, ...values } = input;
    const saved = services.repositories.instancePolicy.update({ id: 'instance', revision: expectedRevision + 1, ...values });
    if (!saved.ok) return saved;
    const audit = recordEvent(services, actor, requestId, { targetKind: 'instance-policy', targetId: 'instance', action: 'instance-policy.configure' });
    return audit.ok ? success({ revision: expectedRevision + 1 }) : audit;
  });
}
