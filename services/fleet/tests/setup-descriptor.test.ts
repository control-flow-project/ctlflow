import test from 'node:test';
import assert from 'node:assert/strict';
import { descriptorUrl } from '@ctlflow/fleetd-contracts/setup';
import { setupDescriptorSchema } from '@ctlflow/crossfire-contracts/onboarding';
import { fetchSetupDescriptor } from '../apps/cli/src/setup-descriptor.js';

const address = 'https://example.test/onboarding/setup.json?ownerMatrixId=%40human%3Aexample.test';
const descriptor = { schemaVersion: 1, server: 'https://example.test', ownerMatrixId: '@human:example.test',
  package: { name: '@ctlflow/fleet', version: '0.1.0' }, instructions: 'Follow this instance’s administrator instructions.\nNo rooms are granted by enrollment.' };

test('setup accepts the exact personalized descriptor and verifies package, server and human owner without redirects', async () => {
  let calls = 0;
  const request: typeof fetch = async (input, options) => {
    calls++;
    assert.equal(String(input), address); assert.equal(options?.redirect, 'error'); assert.equal(options?.credentials, 'omit');
    return Response.json(descriptor);
  };
  const parsed = await fetchSetupDescriptor(address, '0.1.0', new AbortController().signal, request);
  assert(parsed.ok); assert.deepEqual(parsed.value, descriptor); assert.equal(calls, 1);
});

test('setup descriptor has one strict shape and bounded administrator instructions', () => {
  assert(setupDescriptorSchema(descriptor).ok);
  for (const input of [{ ...descriptor, schemaVersion: 2 }, { ...descriptor, existingSession: true },
    { ...descriptor, package: { ...descriptor.package, name: '@private/client' } },
    { ...descriptor, package: { ...descriptor.package, version: '^0.1.0' } },
    { ...descriptor, server: 'https://example.test/' }, { ...descriptor, ownerMatrixId: 'human' },
    { ...descriptor, instructions: '\u0000' }, { ...descriptor, instructions: 'é'.repeat(65537) }]) {
    assert.equal(setupDescriptorSchema(input).ok, false);
  }
});

test('personalized URLs reject ambiguous queries, fragments, credentials, wrong endpoints and unencrypted public origins', () => {
  for (const invalid of [address + '&ownerMatrixId=%40other%3Aexample.test', address + '&server=x', address + '#fragment',
    address.replace('/setup.json', '/setup'), address.replace('https://', 'http://'),
    address.replace('example.test/', 'user:secret@example.test/'), address.replace('ownerMatrixId', 'owner')]) {
    assert.equal(descriptorUrl(invalid).ok, false, invalid);
  }
  assert(descriptorUrl('http://127.0.0.1:8080/onboarding/setup.json?ownerMatrixId=%40owner%3Alocal.test').ok);
});

test('descriptor authority and pinned version are never inferred from text or silently replaced', async () => {
  for (const supplied of [{ ...descriptor, server: 'https://elsewhere.test' }, { ...descriptor, ownerMatrixId: '@other:example.test' },
    { ...descriptor, package: { ...descriptor.package, version: '0.2.0' } }]) {
    const request: typeof fetch = async () => Response.json(supplied);
    const parsed = await fetchSetupDescriptor(address, '0.1.0', new AbortController().signal, request);
    assert.equal(parsed.ok, false);
    if (!parsed.ok && supplied.package.version === '0.2.0') assert.match(parsed.error.message, /@ctlflow\/fleet@0\.2\.0/u);
  }
});

test('descriptor reads refuse invalid UTF-8, wrong content type, oversized bodies and redirects', async () => {
  for (const response of [new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } }),
    new Response(JSON.stringify(descriptor)), new Response(' '.repeat(256 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }),
    new Response(null, { status: 302, headers: { Location: 'https://elsewhere.test/' } })]) {
    const parsed = await fetchSetupDescriptor(address, '0.1.0', new AbortController().signal, async () => response);
    assert.equal(parsed.ok, false);
  }
});

test('invalid setup address performs no network request and cancellation is actionable', async () => {
  let calls = 0;
  const request: typeof fetch = async () => { calls++; throw new Error('Fixture network failure'); };
  const invalid = await fetchSetupDescriptor('https://example.test/onboarding/setup.json', '0.1.0', new AbortController().signal, request);
  assert.equal(invalid.ok, false); assert.equal(calls, 0);
  const stop = new AbortController(); stop.abort();
  const cancelled = await fetchSetupDescriptor(address, '0.1.0', stop.signal, request);
  assert(!cancelled.ok); assert.equal(cancelled.error.message, 'Setup cancelled');
});
