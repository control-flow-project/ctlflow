import { createClient } from '@crossfire/adapter-crossfire/client';
import type { FleetView } from '@crossfire/contracts/schema/response';
import { operations } from '@crossfire/contracts/rest/operations';
import { failure, success, type Result } from '@crossfire/kernel/result';

export async function readFleetDirectory(client: ReturnType<typeof createClient>, search: string): Promise<Result<FleetView[]>> {
  const query = new URLSearchParams(search);
  query.delete('page'); query.set('pageSize', '100');
  const fleets = new Map<string, FleetView>();
  let lastPage = 1;
  for (let page = 1; page <= lastPage; page++) {
    query.set('page', String(page));
    const response = await client.call(operations.fleets, {}, {}, query);
    if (!response.ok) return response;
    if (response.value.meta.page !== page || response.value.meta.pageSize !== 100) return failure('native', 'Fleet directory pagination is invalid');
    if (page === 1) lastPage = response.value.meta.totalPages ?? 1;
    for (const fleet of response.value.data) fleets.set(fleet.fleetId, fleet);
  }
  return success([...fleets.values()]);
}
