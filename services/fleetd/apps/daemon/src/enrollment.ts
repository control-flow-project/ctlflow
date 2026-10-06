import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@ctlflow/crossfire-adapter-crossfire/client';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { loadBinding, saveBinding } from '@ctlflow/fleetd-storage/binding';
import { initializeHistory } from '@ctlflow/fleetd-storage/history';
import { migrateInstanceProfiles } from '@ctlflow/fleetd-storage/profile-migration';
import type { Configuration, Controller, Approval } from '@ctlflow/fleetd-domain/model';

export async function prepareEnrollment(configuration: Configuration, controller: Controller, intent: 'resume' | 'enroll', signal: AbortSignal, approval: (value: Approval) => void) {
  const loaded = loadBinding(configuration);
  if (!loaded.ok) return loaded;
  const binding = loaded.value, roster = configuration.roster;
  if (binding.server !== roster.coordination.server || binding.owner !== roster.coordination.owner || binding.fleetKey !== roster.fleet) return failure('conflict', 'Fleet connection differs from its saved identity; it cannot be silently replaced');
  if (intent === 'resume' && binding.fleetId && binding.controllerCredential
    && roster.instances.every(instance => binding.identities.some(identity => identity.instanceKey === instance.key && identity.name === instance.name))) {
    const authenticated = createClient({ origin: binding.server, token: binding.controllerCredential, signal });
    const current = await authenticated.call(operations.fleet, { fleetId: binding.fleetId }, {});
    if (!current.ok) return current;
    if (current.value.data.fleetId !== binding.fleetId || current.value.data.fleetKey !== binding.fleetKey
      || current.value.data.owner.matrixUserId !== binding.owner) return failure('conflict', 'Approved fleet authority differs from its saved identity');
    const registered = await authenticated.call(operations.fleetAgents, { fleetId: binding.fleetId }, {}, new URLSearchParams({ page: '1', pageSize: '100' }));
    if (!registered.ok) return registered;
    const { data, meta } = registered.value;
    if (meta.page !== 1 || meta.pageSize !== 100 || meta.totalPages !== 1 || meta.totalItems !== data.length
      || data.length !== roster.instances.length || new Set(data.map(item => item.instanceKey)).size !== data.length
      || new Set(data.map(item => item.agent.agentId)).size !== data.length) return failure('conflict', 'Approved fleet roster is incomplete or differs from its configured instances');
    for (const instance of roster.instances) {
      const expected = binding.identities.find(identity => identity.instanceKey === instance.key)!;
      const observed = data.find(item => item.instanceKey === instance.key)?.agent;
      if (!observed || observed.agentId !== expected.agentId || observed.name !== instance.name
        || observed.matrixUserId !== expected.account.user_id || observed.deployment.fleetId !== binding.fleetId
        || observed.deployment.instanceKey !== instance.key || observed.owner.matrixUserId !== binding.owner)
        return failure('conflict', 'Approved fleet instance differs from its saved identity: ' + instance.key);
      if (observed.status !== 'active' || observed.owner.status !== 'active') return failure('forbidden', 'Fleet resume requires active existing agent and owner accounts');
    }
    migrateInstanceProfiles(configuration, binding);
    return success({ failed: [] });
  }
  migrateInstanceProfiles(configuration, binding);
  const instances = roster.instances.map(instance => {
    const existing = binding.identities.find(item => item.instanceKey === instance.key);
    return { instanceKey: instance.key, name: instance.name, coordinationPolicy: configuration.definitions[instance.definition]!.coordinationPolicy,
      ...(existing ? { identity: { agentId: existing.agentId, accessToken: existing.account.access_token } } : {}) };
  });
  const client = createClient({ origin: binding.server, signal });
  const input = { ownerMatrixId: binding.owner, fleetKey: binding.fleetKey, controller, instances, ...(binding.controllerCredential ? { controllerCredential: binding.controllerCredential } : {}) };
  const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  if (binding.request?.digest === digest) {
    const resumed = await client.call(operations.exchangeEnrollment, { enrollmentId: binding.request.enrollmentId }, { claimSecret: binding.request.claimSecret });
    if (!resumed.ok) return resumed;
    if (resumed.value.data.status === 'rejected' || resumed.value.data.status === 'expired') {
      binding.request = null; saveBinding(configuration.directory, binding);
    }
  }
  if (!binding.request || binding.request.digest !== digest) {
    const checked = await client.call(operations.preflight, {}, input);
    if (!checked.ok) return checked;
    if (!checked.value.data.available) return failure('name_collision', 'Fleet names are not available');
    binding.request = { enrollmentId: randomUUID(), claimSecret: randomBytes(32).toString('base64url'), digest };
    saveBinding(configuration.directory, binding);
  }
  const introduced = await client.call(operations.introduceEnrollment, {}, { ...input, enrollmentId: binding.request.enrollmentId, claimSecret: binding.request.claimSecret });
  if (!introduced.ok) return introduced;
  let waiting = false;
  for (;;) {
    signal.throwIfAborted();
    const result = await client.call(operations.exchangeEnrollment, { enrollmentId: binding.request.enrollmentId }, { claimSecret: binding.request.claimSecret });
    if (!result.ok) return result;
    const exchanged = result.value.data;
    if (exchanged.status === 'rejected' || exchanged.status === 'expired') {
      binding.request = null; saveBinding(configuration.directory, binding);
      return failure('forbidden', 'Fleet enrollment is ' + exchanged.status + '; start again to request a new owner review');
    }
    if (exchanged.status === 'pending' && !waiting) {
      waiting = true; approval({ url: introduced.value.data.approvalUrl, code: introduced.value.data.enrollment.enrollment.verificationCode });
    }
    if (exchanged.status === 'ready') {
      if (!exchanged.fleet || exchanged.ownerMatrixId !== binding.owner) return failure('native', 'Enrollment does not match the approved fleet');
      binding.fleetId = exchanged.fleet.fleetId;
      binding.controllerCredential = exchanged.fleet.controllerCredential ?? binding.controllerCredential;
      if (!binding.controllerCredential) return failure('forbidden', 'This fleet controller has not been authorized');
      const failed: { instanceKey: string; code: string; message: string }[] = [];
      for (const instance of exchanged.instances) {
        const requested = roster.instances.find(item => item.key === instance.instanceKey && item.name === instance.name);
        if (!requested) return failure('native', 'Unexpected enrollment identity');
        if (instance.status === 'failed') { failed.push({ instanceKey: instance.instanceKey, code: instance.errorCode ?? 'native', message: instance.name + ': ' + (instance.errorCode ?? 'Enrollment failed') }); continue; }
        if (!instance.agentId || !instance.account) return failure('native', 'Approved identity is not ready');
        const account = { user_id: instance.account.matrixUserId, access_token: instance.account.accessToken, device_id: instance.account.deviceId };
        const existing = binding.identities.find(item => item.instanceKey === instance.instanceKey);
        if (existing && existing.agentId !== instance.agentId) return failure('conflict', 'An enrolled agent identity cannot be replaced');
        if (!existing) initializeHistory(configuration.directory, instance.agentId, null);
        binding.identities = [...binding.identities.filter(item => item.instanceKey !== instance.instanceKey), { instanceKey: instance.instanceKey, name: instance.name, agentId: instance.agentId, account }];
      }
      binding.request = null; saveBinding(configuration.directory, binding);
      const authenticated = createClient({ origin: binding.server, token: binding.controllerCredential, signal });
      const current = await authenticated.call(operations.fleet, { fleetId: binding.fleetId }, {});
      if (!current.ok) return current;
      const updated = await authenticated.call(operations.changeFleet, { fleetId: binding.fleetId }, { expectedRevision: current.value.data.revision, label: current.value.data.label, controller });
      return updated.ok ? success({ failed }) : updated;
    }
    await delay(1000, undefined, { signal });
  }
}
