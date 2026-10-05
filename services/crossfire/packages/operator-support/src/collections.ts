import type { Response } from '@ctlflow/crossfire-contracts/rest/envelope';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';

export async function collectPages<Value>(read: (query: URLSearchParams) => Promise<Result<Response<Value[]>>>, identity: (value: Value) => string | number): Promise<Result<Value[]>> {
  const values: Value[] = [];
  const seen = new Set<string | number>();
  let total: number | undefined, pages: number | undefined;
  for (let page = 1; page <= 10000; page++) {
    const result = await read(new URLSearchParams({ page: String(page), pageSize: '100' }));
    if (!result.ok) return result;
    const meta = result.value.meta;
    if (meta.page !== page || meta.pageSize !== 100 || meta.totalItems === undefined || meta.totalPages === undefined
      || (total !== undefined && (meta.totalItems !== total || meta.totalPages !== pages))) return failure('conflict', 'Collection changed during paginated inspection; rerun the read-only check');
    total = meta.totalItems; pages = meta.totalPages;
    for (const value of result.value.data) {
      const key = identity(value);
      if (key === '' || typeof key === 'number' && !Number.isFinite(key)) return failure('native', 'Collection returned an invalid record identity');
      if (seen.has(key)) return failure('conflict', 'Collection repeated an identity during inspection; rerun the read-only check');
      seen.add(key); values.push(value);
    }
    if (page >= pages) return values.length === total ? success(values) : failure('native', 'Collection pagination omitted or duplicated items');
  }
  return failure('limit', 'Collection exceeds the operator pagination bound');
}
