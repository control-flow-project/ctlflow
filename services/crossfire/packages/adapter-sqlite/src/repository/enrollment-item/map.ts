import type { EnrollmentItem } from '@crossfire/domain/enrollment/types';
import type { Tables } from '../../schema/tables.js';
export function mapEnrollmentItem(row: Tables['enrollment_item']): EnrollmentItem {
  return {
    requestId: row.request_id,
    instanceKey: row.instance_key,
    requestedName: row.requested_name,
    outcome: row.outcome,
    agentId: row.agent_id,
    failureCode: row.failure_code,
  };
}
