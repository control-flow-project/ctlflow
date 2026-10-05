import type { RuntimeObservation } from './values.js';
import type { Services, Actor } from '../port/services.js';
import { authorize, authorizeAgent } from '../authorization/authorize.js';
import { failure, success } from '@crossfire/kernel/result';
import { liveRun } from './decisions.js';
import { openIncident, recoverIncidents } from './incidents.js';
import { agentDisplayName } from '../identity/display-name.js';

const names = new Set(['model', 'model_reasoning_effort', 'sandbox_mode', 'approval_policy', 'native_version',
  'dangerously_bypass_approvals_and_sandbox', 'features.default_mode_request_user_input', 'provider', 'thinking', 'permission_mode']);
export function reportRuntime(services: Services, actor: Actor, agentId: string, runId: string, input: RuntimeObservation) {
  return services.unitOfWork.run(() => {
    const authority = authorize(services, actor, 'runtime.report.self');
    if (!authority.ok) return authority;
    if (actor.principalId !== agentId) return failure('missing', 'Agent not found');
    const run = liveRun(services, agentId, runId);
    if (!run.ok) return run;
    if (input.observedAt > services.clock.now() + 60000 || new Set(input.settings.map(setting => setting.name)).size !== input.settings.length
      || input.settings.some(setting => !names.has(setting.name))) return failure('invalid', 'Only public runtime settings may be reported');
    if (input.lastActivityAt !== null && input.lastActivityAt > services.clock.now() + 60000) return failure('invalid', 'Native activity cannot be reported in the future');
    const previous = services.runtime.observation(agentId);
    if (!previous.ok) return previous;
    const original = previous.value.find(value => value.runId === runId && value.sessionId === input.sessionId);
    if (original && (original.roomId !== input.roomId || original.historyMode !== input.historyMode
      || original.runtime !== input.runtime)) return failure('conflict', 'Native history scope or listener configuration changed within the run');
    if (!original && previous.value.length >= 2002) return failure('limit', 'Too many native histories in this listener run');
    if (previous.value.some(value => value.runId === runId && value.sessionId === input.sessionId && value.observedAt > input.observedAt)) return failure('conflict', 'Runtime observation is older than the recorded state');
    const saved = services.runtime.saveObservation(agentId, { runId, ...input });
    if (!saved.ok) return saved;
    if (input.state === 'failed') {
      const agent = services.directory.agent(agentId);
      if (!agent.ok) return agent;
      if (!agent.value) return failure('missing', 'Agent not found');
      const incident = openIncident(services, { ownerId: agent.value.agent.ownerId, agentId, fleetId: null, runId, sessionId: input.sessionId, kind: 'failure',
        message: agentDisplayName(agent.value.name, agent.value.ownerMember.displayName, agent.value.agent.displayNameOverride) + ' failed: ' + (input.errorMessage ?? 'Native execution failed. Inspect the original session before resuming.') });
      if (!incident.ok) return incident;
    } else if (input.state !== 'unavailable') {
      const recovered = recoverIncidents(services, agentId, null, input.sessionId);
      if (!recovered.ok) return recovered;
    }
    return success({ accepted: true });
  });
}
export function readRuntime(services: Services, actor: Actor, agentId: string) {
  const authorized = authorizeAgent(services, actor, agentId, 'read');
  return authorized.ok ? services.runtime.observation(agentId) : authorized;
}
