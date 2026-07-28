import {
  ConsumerBinding,
  type PlacementBinding,
} from "../../generated/v1/configd.js";

export type TestPlacementScope =
  | { readonly kind: "global" }
  | {
      readonly kind: "tenant";
      readonly tenantId: string;
    }
  | {
      readonly kind: "workspace";
      readonly tenantId: string;
      readonly workspaceId: string;
    }
  | {
      readonly kind: "user";
      readonly tenantId: string;
      readonly accountPrincipalId: string;
    };

export interface CreateConsumerBindingOptions {
  readonly placementId?: string;
  readonly scope?: TestPlacementScope;
  readonly consumerId?: string;
  readonly purpose?: string;
}

export function createConsumerBinding(
  options: CreateConsumerBindingOptions = {}
): ConsumerBinding {
  const scope = options.scope ?? { kind: "global" };
  return ConsumerBinding.create({
    placement: createPlacement(
      options.placementId ?? "placement_test",
      scope),
    consumerId: options.consumerId ?? "workload_test",
    purpose: options.purpose ?? "runtime_config"
  });
}

function createPlacement(
  placementId: string,
  scope: TestPlacementScope
): PlacementBinding {
  switch (scope.kind) {
    case "global":
      return {
        placementId,
        global: {}
      };
    case "tenant":
      return {
        placementId,
        tenant: {
          tenantId: scope.tenantId
        }
      };
    case "workspace":
      return {
        placementId,
        workspace: {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId
        }
      };
    case "user":
      return {
        placementId,
        user: {
          tenantId: scope.tenantId,
          accountPrincipalId: scope.accountPrincipalId
        }
      };
  }
}
