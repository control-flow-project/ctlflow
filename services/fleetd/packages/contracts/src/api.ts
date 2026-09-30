import * as check from '@crossfire/contracts/schema/validation';
import { controller } from '@crossfire/contracts/schema/controller';
import { operation } from '@crossfire/contracts/rest/operation';
import { page, none } from '@crossfire/contracts/schema/query';
import { instance } from './configuration.js';
import { attachment } from './attachment.js';
export const phase = check.choice('stopped', 'starting', 'awaiting-approval', 'running', 'stopping', 'failed');
export const instanceView = check.object({ instance, phase, sessionId: check.nullable(check.text(200)), error: check.nullable(check.text(4096)), startedAt: check.nullable(check.integer()) });
export const fleetView = check.object({ fleetId: check.identifier, fleetKey: check.name, label: check.text(100), directory: check.text(4096), revision: check.integer(), controller,
  phase, instances: check.list(instanceView, 100), error: check.nullable(check.text(4096)) });
export const target = check.object({ kind: check.choice('fleet', 'agent', 'daemon'), fleetId: check.optional(check.identifier), instanceKey: check.optional(check.name) });
export const operationInput = check.object({ operationId: check.identifier, target, action: check.choice('start', 'stop'), expectedRevision: check.integer() });
export const operationView = check.object({ ...{
  operationId: check.identifier, target, action: check.choice('start', 'stop'), expectedRevision: check.integer(),
}, status: check.choice('accepted', 'running', 'awaiting-approval', 'succeeded', 'failed'), createdAt: check.integer(), completedAt: check.nullable(check.integer()),
  approval: check.nullable(check.object({ url: check.text(2048), code: check.text(12, 12) })), errors: check.list(check.object({ instanceKey: check.nullable(check.name), code: check.text(100), message: check.text(4096) }), 100) });
export type FleetView = check.Parsed<typeof fleetView>;
export type InstanceView = check.Parsed<typeof instanceView>;
export type OperationInput = check.Parsed<typeof operationInput>;
export type OperationView = check.Parsed<typeof operationView>;
const common = { auth: 'public' as const, permissions: [], status: 200 as const, collection: false };
const params = check.object({ fleetId: check.identifier });
const agentParams = check.object({ fleetId: check.identifier, instanceKey: check.name });
export const operations = {
  status: operation({ ...common, method: 'GET', path: '/api/status', params: check.empty, query: none, input: check.empty,
    output: check.object({ controller, startedAt: check.integer(), stopping: check.boolean }), description: 'Controller status' }),
  fleets: operation({ ...common, method: 'GET', path: '/api/fleets', params: check.empty, query: page, input: check.empty, output: check.list(fleetView, 100), collection: true, description: 'Registered fleets' }),
  addFleet: operation({ ...common, method: 'POST', path: '/api/fleets', params: check.empty, query: none, input: check.object({ directory: check.text(4096) }), output: fleetView, status: 201, description: 'Register directory' }),
  fleet: operation({ ...common, method: 'GET', path: '/api/fleets/{fleetId}', params, query: none, input: check.empty, output: fleetView, description: 'Fleet details' }),
  changeFleet: operation({ ...common, method: 'PATCH', path: '/api/fleets/{fleetId}', params, query: none, input: check.object({ expectedRevision: check.integer(), label: check.text(100) }), output: fleetView, description: 'Fleet label' }),
  removeFleet: operation({ ...common, method: 'DELETE', path: '/api/fleets/{fleetId}', params, query: none, input: check.object({ expectedRevision: check.integer() }), output: check.object({ accepted: check.boolean }), description: 'Unregister stopped fleet' }),
  agents: operation({ ...common, method: 'GET', path: '/api/fleets/{fleetId}/agents', params, query: page, input: check.empty, output: check.list(instanceView, 100), collection: true, description: 'Fleet instances' }),
  addAgent: operation({ ...common, method: 'POST', path: '/api/fleets/{fleetId}/agents', params, query: none, input: check.object({ expectedRevision: check.integer(), instance }), output: fleetView, status: 201, description: 'Add defined instance' }),
  agent: operation({ ...common, method: 'GET', path: '/api/fleets/{fleetId}/agents/{instanceKey}', params: agentParams, query: none, input: check.empty, output: instanceView, description: 'Instance details' }),
  attachment: operation({ ...common, method: 'GET', path: '/api/fleets/{fleetId}/agents/{instanceKey}/attachment', params: agentParams, query: none, input: check.empty, output: attachment, description: 'Private running-session terminal attachment' }),
  changeAgent: operation({ ...common, method: 'PATCH', path: '/api/fleets/{fleetId}/agents/{instanceKey}', params: agentParams, query: none, input: check.object({ expectedRevision: check.integer(), definition: check.name }), output: fleetView, description: 'Change a stopped instance definition' }),
  removeAgent: operation({ ...common, method: 'DELETE', path: '/api/fleets/{fleetId}/agents/{instanceKey}', params: agentParams, query: none, input: check.object({ expectedRevision: check.integer() }), output: fleetView, description: 'Detach a stopped instance' }),
  operate: operation({ ...common, method: 'POST', path: '/api/operations', params: check.empty, query: none, input: operationInput, output: operationView, status: 202, description: 'Request lifecycle operation' }),
  operation: operation({ ...common, method: 'GET', path: '/api/operations/{operationId}', params: check.object({ operationId: check.identifier }), query: none, input: check.empty, output: operationView, description: 'Observe operation' }),
};
