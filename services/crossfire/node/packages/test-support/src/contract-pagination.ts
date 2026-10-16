import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { contractError, type ContractReply } from './contract-http.js';
import { integer, record } from './contract-process.js';

export async function paginationContracts(scope: TestContext, request: (query: string) => Promise<ContractReply>): Promise<void> {
  await scope.test('pagination accepts only bounded canonical positive decimal integers', async () => {
    for (const [query, page, size] of [['', 1, 20], ['?page=1&pageSize=1', 1, 1], ['?page=2&pageSize=100', 2, 100], ['?page=100000', 100000, 20]] as const) {
      const reply = await request(query); assert.equal(reply.status, 200, query);
      const meta = record(record(reply.body).meta); assert.equal(meta.page, page, query); assert.equal(meta.pageSize, size, query);
      assert.equal(meta.totalPages, Math.max(1, Math.ceil(integer(meta.totalItems) / size)), query);
    }
    for (const value of ['', '0', '01', '+1', '-1', '1.0', '1e0', '0x1', '0b1', '0o1', ' 1', '1 ', '1\n', '١', 'NaN', 'Infinity', '100001', '9007199254740993']) {
      contractError(await request('?page=' + encodeURIComponent(value)), 400, 'invalid');
      contractError(await request('?pageSize=' + encodeURIComponent(value)), 400, 'invalid');
    }
    for (const query of ['?pageSize=101', '?page=1&page=2', '?pageSize=1&pageSize=2', '?unknown=1']) contractError(await request(query), 400, 'invalid');
  });
}
