import { failure } from '@ctlflow/crossfire-kernel/result';
import type { Actor } from '../port/services.js';
import { recordEvent } from '../audit/record-event.js';
import { publicationPublisher, type PublicationDependencies } from './authority.js';
import { readPublication } from './read.js';
import { PUBLICATION_LIMITS, type PublicationCreation } from './values.js';
import { validatePublication } from './validation.js';
export function createPublication(services: PublicationDependencies, actor: Actor, input: PublicationCreation, requestId: string) {
  const valid = validatePublication(input); if (!valid.ok) return valid;
  return services.unitOfWork.run(() => {
    const authority = publicationPublisher(services, actor); if (!authority.ok) return authority;
    const usage = services.publication.repository.usage(actor.principalId); if (!usage.ok) return usage;
    const budget = services.publication.budget;
    if (usage.value.instanceBytes + valid.value > budget.instanceBytes || usage.value.agentBytes + valid.value > budget.agentBytes
      || usage.value.instanceCount >= budget.instanceCount || usage.value.agentCount >= budget.agentCount)
      return failure('capacity', 'Report storage capacity reached; remove unused reports before publishing');
    const id = services.identity.id(), now = services.clock.now();
    const created = services.publication.repository.insert({ id, agentId: actor.principalId, publicKey: services.identity.secret(),
      title: input.title, state: 'staging', revision: 0, createdAt: now, expiresAt: now + PUBLICATION_LIMITS.stagingMilliseconds,
      publishedAt: null, deletedAt: null, cleanedAt: null, totalBytes: valid.value, fileCount: input.files.length },
    input.files.map(file => ({ ...file, id: services.identity.id(), publicationId: id, uploaded: false })));
    if (!created.ok) return created;
    const agent = services.repositories.agent.find({ principalId: actor.principalId }); if (!agent.ok) return agent;
    const audit = recordEvent(services, actor, requestId, { targetKind: 'publication', targetId: id,
      ownerId: agent.value!.ownerId, action: 'publication.create', permissionCode: 'publication.publish.self' });
    return audit.ok ? readPublication(services, actor, id) : audit;
  });
}
