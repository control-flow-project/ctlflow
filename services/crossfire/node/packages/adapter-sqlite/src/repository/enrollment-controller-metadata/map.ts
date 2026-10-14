import type { EnrollmentControllerMetadata } from '@ctlflow/crossfire-domain/enrollment/types';
import type { Tables } from '../../schema/tables.js';
export function mapEnrollmentControllerMetadata(row: Tables['enrollment_controller_metadata']): EnrollmentControllerMetadata {
  return { enrollmentId: row.enrollment_id, key: row.key, value: row.value };
}
