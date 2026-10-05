import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { binaryBytes } from '@crossfire/kernel/bytes';
import { createPublication } from '@crossfire/domain/publication/create';
import { uploadPublicationFile } from '@crossfire/domain/publication/upload';
import { commitPublication } from '@crossfire/domain/publication/commit';
import { deletePublication } from '@crossfire/domain/publication/delete';
import { readPublication, readPublications } from '@crossfire/domain/publication/read';
import { maintainPublications } from '@crossfire/domain/publication/maintenance';
import { PUBLICATION_LIMITS } from '@crossfire/domain/publication/values';
import { validatePublication } from '@crossfire/domain/publication/validation';
import { publicationCreation, publicationQuery } from '@crossfire/contracts/publication';
import { changeInstancePolicy } from '@crossfire/domain/policy/change-policy';
import { deliveryPolicy } from '@crossfire/domain/agent/delivery-policy';
import { applicationFixture, value } from './support/application.js';

function manifest(body = '<!doctype html><p>Report</p>') {
  const bytes = Buffer.from(body);
  return { bytes, input: { title: 'Credit report', files: [{ path: 'index.html', mediaType: 'text/html', bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') }] } };
}

test('static manifests reject traversal, MIME confusion, archives, aliases, duplicates and unbounded sizes', () => {
  const valid = manifest().input; assert(publicationCreation(valid).ok); assert(validatePublication(valid).ok);
  for (const path of ['/index.html', '../index.html', 'a/../index.html', 'a//index.html', 'a\\index.html', '%2e%2e/index.html', '.hidden/index.html', 'a/.hidden/index.html', 'index.HTML', 'bundle.zip', 'script.php', 'a./index.html'])
    assert.equal(validatePublication({ ...valid, files: [{ ...valid.files[0]!, path }] }).ok, false, path);
  for (const extra of [{ mediaType: 'application/javascript' }, { bytes: PUBLICATION_LIMITS.fileBytes + 1 }, { bytes: -1 }, { sha256: 'invalid' }])
    assert.equal(validatePublication({ ...valid, files: [{ ...valid.files[0]!, ...extra }] }).ok, false);
  assert.equal(validatePublication({ ...valid, files: [...valid.files, { ...valid.files[0]!, path: 'INDEX.html' }] }).ok, false);
  assert.equal(validatePublication({ ...valid, files: [...valid.files, { ...valid.files[0]!, path: 'index.html/page.html' }] }).ok, false);
  assert.equal(publicationCreation({ ...valid, files: Array.from({ length: 513 }, (_, index) => ({ ...valid.files[0]!, path: index + '.html' })) }).ok, false);
  assert.equal(validatePublication({ ...valid, files: [{ ...valid.files[0]!, path: 'other.html' }] }).ok, false);
  assert.equal(publicationCreation({ ...valid, unexpected: true }).ok, false);
  for (const query of ['pageSize=101', 'page=1&page=2', 'state=unknown', 'ownerId=admin', 'after=old']) assert.equal(publicationQuery(new URLSearchParams(query)).ok, false);
});

test('staging reserves storage without public visibility; complete verified commit and owner deletion are idempotent', async scope => {
  const fixture = await applicationFixture(scope), agent = await fixture.agent(fixture.admin.actor, 'publisher'), data = manifest();
  const staged = value(createPublication(fixture.services, agent.actor, data.input, randomUUID()));
  assert.equal(staged.state, 'staging'); assert.equal(staged.url, null); assert.equal(staged.files[0]!.uploaded, false);
  const key = value(fixture.services.publication.repository.find(staged.id))!.publication.publicKey;
  assert.equal(value(fixture.services.publication.repository.publicFile(key, 'index.html')), null);
  assert.equal((await commitPublication(fixture.services, agent.actor, staged.id, 0, randomUUID())).ok, false);
  value(await uploadPublicationFile(fixture.services, agent.actor, staged.id, staged.files[0]!.id, binaryBytes(data.bytes), new AbortController().signal));
  const published = value(await commitPublication(fixture.services, agent.actor, staged.id, 0, randomUUID()));
  assert.equal(published.state, 'published'); assert.equal(published.revision, 1); assert.match(published.url!, /^http:\/\/localhost\/[A-Za-z0-9_-]{43}\/index.html$/u);
  assert.equal(value(await commitPublication(fixture.services, agent.actor, staged.id, 0, randomUUID())).url, published.url);
  assert(value(fixture.services.publication.repository.publicFile(key, 'index.html')));
  assert.equal((await uploadPublicationFile(fixture.services, agent.actor, staged.id, staged.files[0]!.id, binaryBytes(data.bytes), new AbortController().signal)).ok, false);
  assert.equal((await deletePublication(fixture.services, fixture.admin.actor, staged.id, 0, randomUUID())).ok, false);
  value(await deletePublication(fixture.services, fixture.admin.actor, staged.id, 1, randomUUID()));
  value(await deletePublication(fixture.services, fixture.admin.actor, staged.id, 1, randomUUID()));
  assert.equal(value(fixture.services.publication.repository.publicFile(key, 'index.html')), null);
  const deleted = value(readPublication(fixture.services, fixture.admin.actor, staged.id)); assert.equal(deleted.state, 'deleted'); assert.equal(deleted.url, null);
  assert.equal(value(fixture.services.publication.repository.usage(agent.id)).instanceBytes, 0);
});

test('publication access uses verified agent identity and current human ownership rather than room membership', async scope => {
  const fixture = await applicationFixture(scope), owner = await fixture.member('owner'), other = await fixture.member('other');
  const agent = await fixture.agent(owner.actor, 'publisher'), another = await fixture.agent(other.actor, 'another');
  const report = value(createPublication(fixture.services, agent.actor, manifest().input, randomUUID()));
  assert.equal(createPublication(fixture.services, owner.actor, manifest().input, randomUUID()).ok, false);
  assert.equal(readPublication(fixture.services, another.actor, report.id).ok, false);
  assert.equal(readPublication(fixture.services, other.actor, report.id).ok, false);
  assert.equal((await deletePublication(fixture.services, agent.actor, report.id, 0, randomUUID())).ok, false);
  assert.equal((await deletePublication(fixture.services, other.actor, report.id, 0, randomUUID())).ok, false);
  assert.equal(value(readPublications(fixture.services, other.actor, { page: 1, pageSize: 1, search: '' })).totalItems, 0);
  assert.equal(value(readPublications(fixture.services, owner.actor, { page: 1, pageSize: 1, search: '' })).totalItems, 1);
  assert.equal(readPublications(fixture.services, other.actor, { page: 1, pageSize: 1, search: '', ownerId: owner.actor.principalId }).ok, false);
  assert.equal(value(readPublications(fixture.services, fixture.admin.actor, { page: 1, pageSize: 1, search: '', ownerId: owner.actor.principalId })).totalItems, 1);
  value(await deletePublication(fixture.services, owner.actor, report.id, 0, randomUUID()));
});

test('owner-scoped report pages filter before counting, ordering and hydration without widening the scope', async scope => {
  const fixture = await applicationFixture(scope), owner = await fixture.member('owner'), other = await fixture.member('other');
  const agent = await fixture.agent(owner.actor, 'publisher'), foreign = await fixture.agent(other.actor, 'foreign-publisher');
  const reports: string[] = [];
  for (let index = 0; index < 3; index++) {
    fixture.advance(1);
    reports.push(value(createPublication(fixture.services, agent.actor, { ...manifest().input, title: 'Review ' + index }, randomUUID())).id);
    value(createPublication(fixture.services, foreign.actor, manifest().input, randomUUID()));
  }
  const query = { page: 1, pageSize: 1, search: 'Review', state: 'staging' as const };
  const first = value(readPublications(fixture.services, owner.actor, query));
  const second = value(readPublications(fixture.services, owner.actor, { ...query, page: 2, agentId: agent.id }));
  assert.equal(first.totalItems, 3); assert.equal(second.totalItems, 3);
  assert.equal(first.items[0]!.id, reports[2]); assert.equal(second.items[0]!.id, reports[1]);
  assert.equal(first.items[0]!.ownerId, owner.actor.principalId);
  assert.equal(value(readPublications(fixture.services, owner.actor, { ...query, agentId: foreign.id })).totalItems, 0);
  assert.equal(value(readPublications(fixture.services, fixture.admin.actor, { ...query, ownerId: owner.actor.principalId })).totalItems, 3);
});

test('quota reservations include incomplete and pending-deletion bytes; expired staging is reclaimed without publication', async scope => {
  const fixture = await applicationFixture(scope), agent = await fixture.agent(fixture.admin.actor, 'publisher'), data = manifest();
  fixture.services.publication.budget.agentBytes = data.bytes.length;
  const first = value(createPublication(fixture.services, agent.actor, data.input, randomUUID()));
  assert.equal(createPublication(fixture.services, agent.actor, data.input, randomUUID()).ok, false);
  fixture.advance(PUBLICATION_LIMITS.stagingMilliseconds + 1);
  assert.equal((await uploadPublicationFile(fixture.services, agent.actor, first.id, first.files[0]!.id, binaryBytes(data.bytes), new AbortController().signal)).ok, false);
  assert.equal(value(await maintainPublications(fixture.services)), 1);
  assert.equal(value(readPublication(fixture.services, fixture.admin.actor, first.id)).state, 'deleted');
  assert.equal(value(fixture.services.publication.repository.usage(agent.id)).agentBytes, 0);
  assert(createPublication(fixture.services, agent.actor, data.input, randomUUID()).ok);
});

test('zero-byte reports still consume agent and instance count quotas; published reports never expire as staging', async scope => {
  const fixture = await applicationFixture(scope), first = await fixture.agent(fixture.admin.actor, 'first-publisher'), second = await fixture.agent(fixture.admin.actor, 'second-publisher');
  const data = manifest(''); fixture.services.publication.budget.agentCount = 1; fixture.services.publication.budget.instanceCount = 2;
  const report = value(createPublication(fixture.services, first.actor, data.input, randomUUID()));
  value(await uploadPublicationFile(fixture.services, first.actor, report.id, report.files[0]!.id, binaryBytes(data.bytes), new AbortController().signal));
  value(await commitPublication(fixture.services, first.actor, report.id, 0, randomUUID()));
  assert.equal(createPublication(fixture.services, first.actor, data.input, randomUUID()).ok, false);
  value(createPublication(fixture.services, second.actor, data.input, randomUUID()));
  fixture.services.publication.budget.agentCount = 2;
  assert.equal(createPublication(fixture.services, first.actor, data.input, randomUUID()).ok, false);
  fixture.advance(PUBLICATION_LIMITS.stagingMilliseconds + 1);
  assert.equal(value(fixture.services.publication.repository.usage(first.id)).instanceCount, 2);
  assert.equal(createPublication(fixture.services, first.actor, data.input, randomUUID()).ok, false);
  assert.equal(value(await maintainPublications(fixture.services)), 1);
  assert.equal(value(readPublication(fixture.services, first.actor, report.id)).state, 'published');
  assert.equal(value(fixture.services.publication.repository.usage(first.id)).instanceCount, 1);
  assert(createPublication(fixture.services, first.actor, data.input, randomUUID()).ok);
});

test('hash mismatch and aborted uploads retain private staging and cannot be committed', async scope => {
  const fixture = await applicationFixture(scope), agent = await fixture.agent(fixture.admin.actor, 'publisher'), data = manifest();
  const report = value(createPublication(fixture.services, agent.actor, data.input, randomUUID()));
  const changed = Buffer.alloc(data.bytes.length, 65);
  assert.equal((await uploadPublicationFile(fixture.services, agent.actor, report.id, report.files[0]!.id, binaryBytes(changed), new AbortController().signal)).ok, false);
  const stopped = new AbortController(); stopped.abort();
  assert.equal((await uploadPublicationFile(fixture.services, agent.actor, report.id, report.files[0]!.id, binaryBytes(data.bytes), stopped.signal)).ok, false);
  assert.equal(value(readPublication(fixture.services, agent.actor, report.id)).files[0]!.uploaded, false);
  assert.equal((await commitPublication(fixture.services, agent.actor, report.id, 0, randomUUID())).ok, false);
});

test('deletion fences the database before a concurrently blocked upload completes; cleanup later frees bytes', async scope => {
  const fixture = await applicationFixture(scope), agent = await fixture.agent(fixture.admin.actor, 'publisher'), data = manifest();
  const report = value(createPublication(fixture.services, agent.actor, data.input, randomUUID()));
  let entered!: () => void, proceed!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { proceed = resolve; });
  const input = { byteLength: data.bytes.length, chunks: { async *[Symbol.asyncIterator]() { entered(); await gate; yield data.bytes; } } };
  const upload = uploadPublicationFile(fixture.services, agent.actor, report.id, report.files[0]!.id, input, new AbortController().signal);
  try {
    await started; value(await deletePublication(fixture.services, fixture.admin.actor, report.id, 0, randomUUID()));
    assert.equal(value(readPublication(fixture.services, fixture.admin.actor, report.id)).state, 'deleted');
    assert.equal(value(fixture.services.publication.repository.usage(agent.id)).agentBytes, data.bytes.length);
  } finally { proceed(); }
  assert.equal((await upload).ok, false); assert.equal(value(await maintainPublications(fixture.services)), 1);
  assert.equal(value(fixture.services.publication.repository.usage(agent.id)).agentBytes, 0);
});

test('instance idle policy has canonical 1800-second default, configurable zero and delivery propagation', async scope => {
  const fixture = await applicationFixture(scope), agent = await fixture.agent(fixture.admin.actor, 'publisher');
  const policy = value(fixture.services.repositories.instancePolicy.find({ id: 'instance' }))!;
  assert.equal(policy.fleetIdleTimeoutSeconds, 1800);
  assert.equal(value(deliveryPolicy(fixture.services, agent.actor, agent.id)).fleetIdleTimeoutSeconds, 1800);
  const { id, revision, ...input } = policy; assert.equal(id, 'instance');
  value(changeInstancePolicy(fixture.services, fixture.admin.actor, { ...input, expectedRevision: revision, fleetIdleTimeoutSeconds: 0 }, randomUUID()));
  assert.equal(value(deliveryPolicy(fixture.services, agent.actor, agent.id)).fleetIdleTimeoutSeconds, 0);
  assert.equal(changeInstancePolicy(fixture.services, fixture.admin.actor, { ...input, expectedRevision: revision + 1, fleetIdleTimeoutSeconds: -1 }, randomUUID()).ok, false);
});
