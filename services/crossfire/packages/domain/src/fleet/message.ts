import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Page, PageRequest } from '../port/directory.js';
import type { Services } from '../port/services.js';
import type { FleetActor } from './authority.js';
import { runtimeOperationView } from './runtime-types.js';
import { authorizedFleet, liveFleetConnection, controlView, connectionView, type FleetControlServices } from './control.js';
import { recordEvent } from '../audit/record-event.js';
import { FLEET_MESSAGE_LIFETIME_MS, MAX_FLEET_MESSAGE_BYTES, type FleetMessage, type FleetMessageDelivery, type FleetMessageCommand, type FleetControlSnapshot } from './control-types.js';

type MessageServices = FleetControlServices & Pick<Services, 'discovery'>;
export type FleetMessageSummary = { messageId: string; body: string; createdAt: number; expiresAt: number; total: number; delivered: number; failed: number; skipped: number; pending: number; expired: number };
function summary(message: FleetMessage, deliveries: FleetMessageDelivery[], now: number): FleetMessageSummary {
  return { messageId: message.id, body: message.body, createdAt: message.createdAt, expiresAt: message.expiresAt, total: deliveries.length,
    delivered: deliveries.filter(value => value.status === 'delivered').length, failed: deliveries.filter(value => value.status === 'failed').length,
    skipped: deliveries.filter(value => value.status === 'skipped').length,
    pending: deliveries.filter(value => value.status === 'pending' && message.expiresAt > now).length,
    expired: deliveries.filter(value => value.status === 'pending' && message.expiresAt <= now).length };
}
export function createFleetMessage(services: MessageServices, actor: FleetActor, fleetId: string, input: { messageId: string; body: string }, requestId: string): Result<FleetMessageSummary> {
  if (!input.body.trim() || input.body.length > 4096 || new TextEncoder().encode(input.body).length > MAX_FLEET_MESSAGE_BYTES
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.body)) return failure('invalid', 'Fleet message must contain plain text of 1–4096 characters and at most 16 KiB');
  return services.unitOfWork.run(() => {
    const fleet = authorizedFleet(services, actor, fleetId, true); if (!fleet.ok) return fleet;
    const previous = services.repositories.fleetMessage.find(input.messageId); if (!previous.ok) return previous;
    if (previous.value) {
      if (previous.value.fleetId !== fleetId || previous.value.body !== input.body
        || previous.value.authorPrincipalId !== (actor.kind === 'controller' ? null : actor.principalId)
        || previous.value.authorCredentialId !== (actor.kind === 'controller' ? actor.credentialId : null)) return failure('conflict', 'Message ID belongs to a different request');
      const deliveries = services.repositories.fleetMessageDelivery.forMessages([input.messageId]);
      return deliveries.ok ? success(summary(previous.value, deliveries.value, services.clock.now())) : deliveries;
    }
    const connection = services.repositories.fleetConnection.find(fleetId); if (!connection.ok) return connection;
    if (!fleet.value.deliveryEnabled || connectionView(connection.value, services.clock.now()).status !== 'online') return failure('conflict', 'Activate this fleet and connect its controller before sending a message');
    const count = services.repositories.fleetMessageDelivery.pendingCount(fleetId, services.clock.now()); if (!count.ok) return count;
    if (count.value >= 32) return failure('capacity', 'This fleet already has 32 pending messages');
    const instances = services.collection.fleetInstances(fleet.value); if (!instances.ok) return instances;
    if (!instances.value.length) return failure('conflict', 'This fleet has no enrolled agents');
    const agents = services.directory.agents({ agentIds: instances.value.map(instance => instance.agentId), page: 1, pageSize: 100,
      statuses: ['active', 'suspended', 'revoked'], search: '' });
    if (!agents.ok) return agents;
    if (agents.value.totalItems !== instances.value.length || agents.value.totalItems > 100) return failure('conflict', 'Fleet roster is incomplete or exceeds its bound');
    const activeIds = new Set(agents.value.items.filter(agent => agent.principal.status === 'active').map(agent => agent.principal.id));
    const now = services.clock.now(), message: FleetMessage = { id: input.messageId, fleetId, body: input.body, createdAt: now, expiresAt: now + FLEET_MESSAGE_LIFETIME_MS,
      authorPrincipalId: actor.kind === 'controller' ? null : actor.principalId, authorCredentialId: actor.kind === 'controller' ? actor.credentialId : null };
    const saved = services.repositories.fleetMessage.insert(message); if (!saved.ok) return saved;
    const deliveries: FleetMessageDelivery[] = [];
    for (const instance of instances.value) {
      const active = activeIds.has(instance.agentId);
      const delivery: FleetMessageDelivery = { messageId: message.id, agentId: instance.agentId, status: active ? 'pending' : 'skipped',
        completedAt: active ? null : now, errorMessage: active ? null : 'Agent account is not active' };
      const created = services.repositories.fleetMessageDelivery.insert(delivery); if (!created.ok) return created;
      deliveries.push(delivery);
    }
    const audit = recordEvent(services, actor, requestId, { targetKind: 'fleet', targetId: fleetId, ownerId: fleet.value.ownerId, action: 'fleet.message.create', message: message.id });
    return audit.ok ? success(summary(message, deliveries, now)) : audit;
  });
}
export function listFleetMessages(services: MessageServices, actor: FleetActor, fleetId: string, page: PageRequest): Result<Page<FleetMessageSummary>> {
  const fleet = authorizedFleet(services, actor, fleetId); if (!fleet.ok) return fleet;
  const messages = services.repositories.fleetMessage.page(fleetId, page); if (!messages.ok) return messages;
  const deliveries = services.repositories.fleetMessageDelivery.forMessages(messages.value.items.map(message => message.id)); if (!deliveries.ok) return deliveries;
  return success({ ...messages.value, items: messages.value.items.map(message => summary(message, deliveries.value.filter(delivery => delivery.messageId === message.id), services.clock.now())) });
}
export function readFleetControl(services: MessageServices, actor: FleetActor, fleetId: string, connectionId: string): Result<FleetControlSnapshot> {
  const current = liveFleetConnection(services, actor, fleetId, connectionId); if (!current.ok) return current;
  const pendingOperation = services.repositories.fleetRuntimeOperation.pending(fleetId); if (!pendingOperation.ok) return pendingOperation;
  const view = { ...controlView(current.value.fleet, current.value.connection, services.clock.now()),
    runtimeOperations: pendingOperation.value ? [runtimeOperationView(pendingOperation.value)] : [] };
  const instances = services.collection.fleetInstances(current.value.fleet); if (!instances.ok) return instances;
  const eligible = services.directory.agents({ agentIds: instances.value.map(instance => instance.agentId), page: 1, pageSize: 100,
    statuses: ['active'], search: '' });
  if (!eligible.ok) return eligible;
  const agentIds = eligible.value.items.filter(agent => agent.owner.status === 'active').map(agent => agent.principal.id);
  if (!view.deliveryEnabled) return success({ ...view, agentIds, messages: [] });
  const pending = services.repositories.fleetMessageDelivery.pending(fleetId, services.clock.now()); if (!pending.ok) return pending;
  if (!pending.value) return success({ ...view, agentIds, messages: [] });
  const message = services.repositories.fleetMessage.find(pending.value); if (!message.ok) return message;
  if (!message.value) return failure('unavailable', 'Fleet message is missing');
  const deliveries = services.repositories.fleetMessageDelivery.forMessages([pending.value]); if (!deliveries.ok) return deliveries;
  const sender = message.value.authorPrincipalId ? services.repositories.principal.find({ id: message.value.authorPrincipalId }) : success(null);
  if (!sender.ok) return sender;
  if (message.value.authorPrincipalId && !sender.value) return failure('unavailable', 'Fleet message sender is missing');
  const command: FleetMessageCommand = { messageId: message.value.id, fleetId, body: message.value.body, createdAt: message.value.createdAt,
    expiresAt: message.value.expiresAt, sender: { kind: message.value.authorPrincipalId ? 'human' : 'controller', matrixUserId: sender.value?.matrixUserId ?? null },
    agentIds: deliveries.value.filter(delivery => delivery.status === 'pending').map(delivery => delivery.agentId) };
  return success({ ...view, agentIds, messages: [command] });
}
export function acknowledgeFleetMessage(services: FleetControlServices, actor: FleetActor, fleetId: string, messageId: string, agentId: string,
  input: { status: 'delivered' | 'failed' | 'skipped'; errorMessage: string | null }) {
  if (actor.kind !== 'controller') return failure('forbidden', 'Only this fleet controller may report message receipts');
  if ((input.status === 'delivered') !== (input.errorMessage === null)) return failure('invalid', 'Only failed/skipped deliveries have an error message');
  return services.unitOfWork.run(() => {
    const fleet = authorizedFleet(services, actor, fleetId); if (!fleet.ok) return fleet;
    const message = services.repositories.fleetMessage.find(messageId); if (!message.ok) return message;
    if (!message.value || message.value.fleetId !== fleetId) return failure('missing', 'Fleet message not found');
    const delivery = services.repositories.fleetMessageDelivery.find(messageId, agentId); if (!delivery.ok) return delivery;
    if (!delivery.value) return failure('missing', 'Fleet message recipient not found');
    if (delivery.value.status !== 'pending') return delivery.value.status === input.status && delivery.value.errorMessage === input.errorMessage
      ? success(delivery.value) : failure('conflict', 'This recipient already has a different final outcome');
    const next = { ...delivery.value, ...input, completedAt: services.clock.now() };
    const saved = services.repositories.fleetMessageDelivery.update(next);
    return saved.ok ? success(next) : saved;
  });
}
