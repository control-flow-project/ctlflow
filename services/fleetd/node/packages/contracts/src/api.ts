import { MAX_HISTORY_CONTEXT } from '@ctlflow/crossfire-kernel/history-context';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { controller } from '@ctlflow/crossfire-contracts/schema/controller';
import { operation } from '@ctlflow/crossfire-contracts/rest/operation';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { page, none } from '@ctlflow/crossfire-contracts/schema/query';
import { attachment } from './attachment.js';
import { fleetControl, fleetMessageSummary, deliveryChange, messageCreation } from '@ctlflow/crossfire-contracts/fleet-control';
import { setupInput } from './setup.js';
import { runtimeOptions } from './configuration.js';
import { diagnosticQuery, diagnosticReport } from './diagnostics.js';
const releaseDirectory = check.refine(check.text(4096), value => value.startsWith('/') && !value.includes('\\')
  && value.split('/').slice(1).every(segment => segment && segment !== '.' && segment !== '..'), 'Release directory must be an absolute normalized path');
const instance = check.object({ key: check.name, name: check.name, definition: check.name, workarea: check.text(1024),
  workspace: check.optional(check.text(4096)),
  runtimeOptions: check.optional(runtimeOptions),
  listenerOptions: check.optional(check.object({ historyMode: check.optional(check.choice('shared', 'per-room')), mirrorOutput: check.optional(check.boolean) })) });
export const phase = check.choice('stopped', 'starting', 'awaiting-approval', 'running', 'sleeping', 'waking', 'stopping', 'failed');
export const instanceView = check.object({ instance, phase, listenerActive: check.boolean, desiredActive: check.boolean,
  lastActivityAt: check.nullable(check.integer()), historyAvailable: check.nullable(check.boolean),
  sessionId: check.nullable(check.text(200)), error: check.nullable(check.text(4096)), startedAt: check.nullable(check.integer()) });
export const fleetView = check.object({ fleetId: check.identifier, fleetKey: check.name, label: check.text(100), directory: check.text(4096), revision: check.integer(), controller,
  resumeInstanceKeys: check.nullable(check.list(check.name, 100)),
  phase, instances: check.list(instanceView, 100), error: check.nullable(check.text(4096)),
  connection: check.object({ connected: check.boolean, deliveryEnabled: check.boolean, revision: check.nullable(check.integer()), error: check.nullable(check.text(4096)) }) });
export const target = check.object({ kind: check.choice('fleet', 'agent', 'daemon'), fleetId: check.optional(check.identifier), instanceKey: check.optional(check.name) });
const operationFields = { operationId: check.identifier, target, action: check.choice('enroll', 'start', 'stop', 'reset', 'update'), expectedRevision: check.integer(),
  releaseDirectory: check.optional(releaseDirectory) };
export const operationInput = check.refine(check.object(operationFields), value => (value.action === 'update') === (value.releaseDirectory !== undefined),
  'Only an explicit software update supplies its installed release directory');
export const operationView = check.refine(check.object({ ...{
  ...operationFields,
}, receiptPending: check.optional<true>(input => input === true ? success(true) : failure('invalid', 'Only unacknowledged controller requests are pinned')),
  status: check.choice('accepted', 'running', 'awaiting-approval', 'succeeded', 'failed'), createdAt: check.integer(), completedAt: check.nullable(check.integer()),
  approval: check.nullable(check.object({ url: check.text(2048), code: check.text(12, 12) })), errors: check.list(check.object({ instanceKey: check.nullable(check.name), code: check.text(100), message: check.text(4096) }), 100) }),
  value => (value.action === 'update') === (value.releaseDirectory !== undefined), 'Only an explicit software update supplies its installed release directory');
export type FleetView = check.Parsed<typeof fleetView>;
export type InstanceView = check.Parsed<typeof instanceView>;
export type OperationInput = check.Parsed<typeof operationInput>;
export type OperationView = check.Parsed<typeof operationView>;
const common = { auth: 'controller' as const, permissions: [], status: 200 as const, collection: false };
const params = check.object({ fleetId: check.identifier });
const agentParams = check.object({ fleetId: check.identifier, instanceKey: check.name });
export const setupResult = check.object({ fleet: fleetView, operation: check.nullable(operationView), status: check.choice('starting', 'ready', 'stopped') });
export const operations = {
  diagnostics: operation({ ...common, method: 'GET', path: '/api/diagnostics', params: check.empty, query: diagnosticQuery, input: check.empty,
    output: diagnosticReport, description: 'Read bounded diagnostics without starting sessions, refreshing credentials or repairing state' }),
  setup: operation({ ...common, method: 'POST', path: '/api/setup', params: check.empty, query: none, input: setupInput,
    output: setupResult, description: 'Set up an ordinary fleet without configuration questions; preserve prior stop intent' }),
  status: operation({ ...common, method: 'GET', path: '/api/status', params: check.empty, query: none, input: check.empty,
    output: check.object({ controller, startedAt: check.integer(), stopping: check.boolean,
      loggingRetentionDays: check.integer(1), loggingError: check.nullable(check.text(4096)) }), description: 'Controller status' }),
  fleets: operation({ ...common, method: 'GET', path: '/api/fleets', params: check.empty, query: page, input: check.empty, output: check.list(fleetView, 100), collection: true, description: 'Registered fleets' }),
  addFleet: operation({ ...common, method: 'POST', path: '/api/fleets', params: check.empty, query: none, input: check.object({ directory: check.text(4096) }), output: fleetView, status: 201, description: 'Register directory' }),
  fleet: operation({ ...common, method: 'GET', path: '/api/fleets/{fleetId}', params, query: none, input: check.empty, output: fleetView, description: 'Fleet details' }),
  readiness: operation({ ...common, method: 'GET', path: '/api/fleets/{fleetId}/readiness', params, query: none, input: check.empty,
    output: check.object({ accepted: check.boolean }), description: 'Verify desired listeners through their live model-free native diagnostic without starting sessions' }),
  changeFleet: operation({ ...common, method: 'PATCH', path: '/api/fleets/{fleetId}', params, query: none, input: check.object({ expectedRevision: check.integer(), label: check.text(100) }), output: fleetView, description: 'Fleet label' }),
  removeFleet: operation({ ...common, method: 'DELETE', path: '/api/fleets/{fleetId}', params, query: none, input: check.object({ expectedRevision: check.integer() }), output: check.object({ accepted: check.boolean }), description: 'Unregister stopped fleet' }),
  changeFleetDelivery: operation({ ...common, method: 'PUT', path: '/api/fleets/{fleetId}/delivery', params, query: none, input: deliveryChange, output: fleetControl, description: 'Change Crossfire delivery intent' }),
  createFleetMessage: operation({ ...common, method: 'POST', path: '/api/fleets/{fleetId}/messages', params, query: none, input: messageCreation, output: fleetMessageSummary, status: 201, description: 'Message the enrolled roster through its controller' }),
  agents: operation({ ...common, method: 'GET', path: '/api/fleets/{fleetId}/agents', params, query: page, input: check.empty, output: check.list(instanceView, 100), collection: true, description: 'Fleet instances' }),
  addAgent: operation({ ...common, method: 'POST', path: '/api/fleets/{fleetId}/agents', params, query: none, input: check.object({ expectedRevision: check.integer(), instance }), output: fleetView, status: 201, description: 'Add defined instance' }),
  agent: operation({ ...common, method: 'GET', path: '/api/fleets/{fleetId}/agents/{instanceKey}', params: agentParams, query: none, input: check.empty, output: instanceView, description: 'Instance details' }),
  contexts: operation({ ...common, method: 'GET', path: '/api/fleets/{fleetId}/agents/{instanceKey}/contexts', params: agentParams, query: none, input: check.empty,
    output: check.list(check.object({ context: check.text(MAX_HISTORY_CONTEXT), runtime: check.name, sessionId: check.text(200) }), 2002), description: 'Read retained native history identities without starting a session' }),
  attachment: operation({ ...common, method: 'GET', path: '/api/fleets/{fleetId}/agents/{instanceKey}/attachment', params: agentParams,
    query: input => { if (!(input instanceof URLSearchParams) || [...input.keys()].some(key => key !== 'context') || input.getAll('context').length > 1) return failure('invalid', 'Use one exact context'); return check.object({ context: check.optional(check.text(MAX_HISTORY_CONTEXT)) })(input.has('context') ? { context: input.get('context') } : {}); },
    input: check.empty, output: attachment, description: 'Read a private live terminal pointer; sleeping and stopped sessions require explicit resume' }),
  changeAgent: operation({ ...common, method: 'PATCH', path: '/api/fleets/{fleetId}/agents/{instanceKey}', params: agentParams, query: none, input: check.object({ expectedRevision: check.integer(), definition: check.name }), output: fleetView, description: 'Change a stopped instance definition' }),
  removeAgent: operation({ ...common, method: 'DELETE', path: '/api/fleets/{fleetId}/agents/{instanceKey}', params: agentParams, query: none, input: check.object({ expectedRevision: check.integer() }), output: fleetView, description: 'Retire a stopped instance registration while preserving private history' }),
  operate: operation({ ...common, method: 'POST', path: '/api/operations', params: check.empty, query: none, input: operationInput, output: operationView, status: 202, description: 'Request lifecycle operation' }),
  operation: operation({ ...common, method: 'GET', path: '/api/operations/{operationId}', params: check.object({ operationId: check.identifier }), query: none, input: check.empty, output: operationView, description: 'Observe operation' }),
};
