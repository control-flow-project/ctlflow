import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import type { ListenerRun } from '../activity/types.js';
import { authenticateController } from '../fleet/authority.js';
import { admitsController } from './admission.js';

type Dependencies = Pick<Services, 'repositories' | 'identity' | 'clock'>;
export type ControllerProof = { fleetId: string; connectionId: string; credential: string };

export function controllerProof(services: Dependencies, agentId: string, proof: ControllerProof) {
  if (!proof || typeof proof.fleetId !== 'string' || typeof proof.connectionId !== 'string' || typeof proof.credential !== 'string')
    return failure('invalid', 'A verified fleet controller connection is required');
  const actor = authenticateController(services, proof.credential); if (!actor.ok) return actor;
  if (actor.value.fleetId !== proof.fleetId) return failure('forbidden', 'Controller authority belongs to another fleet');
  const binding = services.repositories.fleetInstance.findByAgent(agentId); if (!binding.ok) return binding;
  const fleet = services.repositories.fleet.findById(proof.fleetId); if (!fleet.ok) return fleet;
  if (!binding.value || binding.value.retiredAt !== null || !fleet.value || fleet.value.archivedAt !== null || binding.value.ownerId !== fleet.value.ownerId || binding.value.fleetKey !== fleet.value.fleetKey)
    return failure('forbidden', 'Controller authority does not cover this agent');
  return success({ fleetId: proof.fleetId, connectionId: proof.connectionId, credentialId: actor.value.credentialId });
}

export function controllerAdmission(services: Pick<Services, 'repositories' | 'clock'>, run: Pick<ListenerRun, 'agentId' | 'controller'>) {
  if (!run.controller) return success(false);
  const binding = services.repositories.fleetInstance.findByAgent(run.agentId); if (!binding.ok) return binding;
  const fleet = services.repositories.fleet.findById(run.controller.fleetId); if (!fleet.ok) return fleet;
  const connection = services.repositories.fleetConnection.find(run.controller.fleetId); if (!connection.ok) return connection;
  const credential = services.repositories.fleetCredential.find({ id: run.controller.credentialId }); if (!credential.ok) return credential;
  const owner = fleet.value ? services.repositories.principal.find({ id: fleet.value.ownerId }) : success(null); if (!owner.ok) return owner;
  const facts = binding.value && fleet.value && connection.value && credential.value && owner.value
    ? { binding: binding.value, fleet: fleet.value, connection: connection.value, credential: credential.value, ownerStatus: owner.value.status } : null;
  return success(admitsController(run, facts, services.clock.now()));
}
