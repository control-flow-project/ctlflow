import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import { addressKey, publicRequestBudget, trustedProxyAddresses } from '../apps/server/src/http/public-request-budget.js';
import { HTTP_LIMITS } from '@ctlflow/crossfire-contracts/rest/limits';

function request(peer: string, forwarded?: string, duplicate = false): Pick<IncomingMessage, 'socket' | 'headers' | 'rawHeaders'> {
  return { socket: { remoteAddress: peer } as IncomingMessage['socket'], headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
    rawHeaders: forwarded === undefined ? [] : duplicate ? ['X-Forwarded-For', forwarded, 'x-forwarded-for', forwarded] : ['X-Forwarded-For', forwarded] };
}

test('only explicit proxy IPs establish one validated client address', () => {
  assert.equal(addressKey('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(addressKey('2001:DB8::1'), '2001:0db8:0000:0000:0000:0000:0000:0001');
  for (const invalid of ['127.1', '0177.0.0.1', '2130706433', '127.0.0.1:80', '::1%lo', ' 127.0.0.1', 'unknown', '192.0.2.1, 192.0.2.2']) assert.equal(addressKey(invalid), null, invalid);
  for (const invalid of [null, '127.0.0.1', ['0.0.0.0/0'], ['localhost'], ['::ffff:127.0.0.1', '127.0.0.1'], Array(33).fill('::1')]) assert.equal(trustedProxyAddresses(invalid).ok, false);
  const proxies = trustedProxyAddresses(['::ffff:127.0.0.1']); assert(proxies.ok);
  const rate = publicRequestBudget(() => 0, proxies.value);
  for (const invalid of [undefined, '', '198.51.100.1, 203.0.113.1', '127.1']) assert.equal(rate(request('127.0.0.1', invalid)).ok, false);
  assert.equal(rate(request('127.0.0.1', '198.51.100.1', true)).ok, false);
  assert.equal(rate(request('127.0.0.1', '198.51.100.1')).ok, true);
});

test('client exhaustion, spoofing, aggregate exhaustion and exact clock rollover are independent', () => {
  let time = 0;
  const rate = publicRequestBudget(() => time, ['127.0.0.1']);
  for (let index = 0; index < HTTP_LIMITS.publicMutationsPerMinute; index++) assert.equal(rate(request('127.0.0.1', '198.51.100.1')).ok, true);
  assert.equal(rate(request('127.0.0.1', '198.51.100.1')).ok, false);
  assert.equal(rate(request('127.0.0.1', '198.51.100.2')).ok, true);
  time = 59999; assert.equal(rate(request('127.0.0.1', '198.51.100.1')).ok, false);
  time = 60000; assert.equal(rate(request('127.0.0.1', '198.51.100.1')).ok, true);
  const direct = publicRequestBudget(() => time);
  for (let index = 0; index < HTTP_LIMITS.publicMutationsPerMinute; index++) assert.equal(direct(request('192.0.2.1', '198.51.100.' + index)).ok, true);
  assert.equal(direct(request('::ffff:192.0.2.1', '203.0.113.1')).ok, false);
  const aggregate = publicRequestBudget(() => time, ['127.0.0.1']);
  for (let index = 0; index < HTTP_LIMITS.publicMutationsGlobalPerMinute; index++) assert.equal(aggregate(request('127.0.0.1', '2001:db8::' + (index + 1).toString(16))).ok, true);
  assert.equal(aggregate(request('127.0.0.1', '203.0.113.2')).ok, false);
  time += 60000; assert.equal(aggregate(request('127.0.0.1', '203.0.113.2')).ok, true);
});
