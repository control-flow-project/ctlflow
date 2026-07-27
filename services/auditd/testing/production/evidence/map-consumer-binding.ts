import type {
  ConsumerBindingAuditEvidence
} from "../audit-event-evidence.js";
import {
  mapPlacementTarget
} from "./map-placement-target.js";

export interface StoredConsumerBinding {
  readonly binding_placement_id: string;
  readonly binding_target_kind: number;
  readonly binding_target_tenant_id: string | null;
  readonly binding_target_workspace_id: string | null;
  readonly binding_target_account_principal_id: string | null;
  readonly binding_consumer_id: string;
  readonly binding_purpose: string;
}

export function mapConsumerBinding(
  row: StoredConsumerBinding
): ConsumerBindingAuditEvidence {
  return {
    placementId: row.binding_placement_id,
    placementTarget: mapPlacementTarget(
      row.binding_target_kind,
      row.binding_target_tenant_id,
      row.binding_target_workspace_id,
      row.binding_target_account_principal_id),
    consumerId: row.binding_consumer_id,
    purpose: row.binding_purpose
  };
}
