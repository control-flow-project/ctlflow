import type { Services, Actor } from '../port/services.js';
import type { PageRequest } from '../port/directory.js';
import { authorizeAgent } from '../authorization/authorize.js';
export function readListenerRuns(services: Pick<Services, 'repositories' | 'directory' | 'listenerRead' | 'clock'>, actor: Actor, agentId: string, input: PageRequest) {
  const target = authorizeAgent(services, actor, agentId, 'read');
  return target.ok ? services.listenerRead.history(agentId, input) : target;
}
