import assert from "node:assert/strict";
import { test } from "node:test";
import {
  status
} from "@grpc/grpc-js";
import {
  AppMutationAction,
  ExecutionDesiredState,
  IdentitySessionAction,
  PlacementMutationAction,
  ProjectionMutationAction,
  RunMutationAction,
  TenancyResourceState,
  TenantMutationAction,
  WorkloadMutationAction,
  WorkspaceMutationAction,
  type AuditEvent
} from "../generated/v1/auditd.js";
import {
  getAuditdTestContext
} from "../suite/get-auditd-test-context.js";
import {
  findAdmittedAuditEvent,
  type AdmittedAuditEvent,
  type AuditDetailField
} from "../support/audit-events/find-admitted-audit-event.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  recordAuditBatch
} from "../support/record-audit-batch.js";

type Mutate = (event: AuditEvent) => void;

test("validates Tenant and Workspace mutation details", async () => {
  const tenant = admitted("tenantd", "tenantMutation");
  await rejectCases(tenant, [
    ["tenant action unspecified", (event) => {
      event.tenantMutation!.action =
        TenantMutationAction.TENANT_MUTATION_ACTION_UNSPECIFIED;
    }],
    ["tenant action unknown", (event) => {
      event.tenantMutation!.action = 99 as TenantMutationAction;
    }],
    ["tenant state unspecified", (event) => {
      event.tenantMutation!.resultingState =
        TenancyResourceState.TENANCY_RESOURCE_STATE_UNSPECIFIED;
    }],
    ["tenant state unknown", (event) => {
      event.tenantMutation!.resultingState =
        99 as TenancyResourceState;
    }],
    ["create revision", (event) => {
      event.tenantMutation!.resourceRevision = 2n;
    }],
    ["create state", (event) => {
      event.tenantMutation!.resultingState =
        TenancyResourceState.TENANCY_RESOURCE_STATE_SUSPENDED;
    }]
  ]);

  const workspace = admitted("tenantd", "workspaceMutation");
  await rejectCases(workspace, [
    ["empty Workspace ID", (event) => {
      event.workspaceMutation!.workspaceId = "";
    }],
    ["noncanonical Workspace ID", (event) => {
      event.workspaceMutation!.workspaceId = "Upper";
    }],
    ["overlong Workspace ID", (event) => {
      event.workspaceMutation!.workspaceId = "a".repeat(65);
    }],
    ["workspace action unspecified", (event) => {
      event.workspaceMutation!.action =
        WorkspaceMutationAction
          .WORKSPACE_MUTATION_ACTION_UNSPECIFIED;
    }],
    ["workspace action unknown", (event) => {
      event.workspaceMutation!.action =
        99 as WorkspaceMutationAction;
    }],
    ["workspace update revision", (event) => {
      event.workspaceMutation!.action =
        WorkspaceMutationAction
          .WORKSPACE_MUTATION_ACTION_UPDATE_WORKSPACE;
      event.workspaceMutation!.resourceRevision = 1n;
    }]
  ]);
});

test("validates Identity Session and Package details", async () => {
  const identity = admitted("identityd", "identitySession");
  await rejectCases(identity, [
    ["empty Session ID", (event) => {
      event.identitySession!.sessionId = "";
    }],
    ["nonhex Session ID", (event) => {
      event.identitySession!.sessionId = "g".repeat(32);
    }],
    ["short Session ID", (event) => {
      event.identitySession!.sessionId = "a".repeat(31);
    }],
    ["service account Session owner", (event) => {
      event.identitySession!.humanAccountPrincipalId =
        "service:automation";
    }],
    ["invalid Session owner", (event) => {
      event.identitySession!.humanAccountPrincipalId = "user:Upper";
    }],
    ["Session action unspecified", (event) => {
      event.identitySession!.action =
        IdentitySessionAction.IDENTITY_SESSION_ACTION_UNSPECIFIED;
    }],
    ["Session action unknown", (event) => {
      event.identitySession!.action = 99 as IdentitySessionAction;
    }],
    ["created Session revision", (event) => {
      event.identitySession!.sessionRevision = 2n;
    }]
  ]);

  const declaration = admitted("pkgd", "packageDeclaration");
  await rejectCases(declaration, [
    ["empty Package ID", (event) => {
      event.packageDeclaration!.packageId = "";
    }],
    ["noncanonical Package ID", (event) => {
      event.packageDeclaration!.packageId = "Upper";
    }],
    ["overlong Package ID", (event) => {
      event.packageDeclaration!.packageId = "a".repeat(129);
    }],
    ["zero Package generation", (event) => {
      event.packageDeclaration!.generation = 0n;
    }],
    ["overflowing Package generation", (event) => {
      event.packageDeclaration!.generation =
        9_223_372_036_854_775_808n;
    }]
  ]);
});

test("validates App mutation details", async () => {
  const app = admitted("pkgd", "appMutation");
  await rejectCases(app, [
    ["empty App ID", (event) => {
      event.appMutation!.appId = "";
    }],
    ["invalid App ID", (event) => {
      event.appMutation!.appId = "app.dot";
    }],
    ["missing App scope", (event) => {
      event.appMutation!.scope = undefined;
    }],
    ["invalid App scope Tenant", (event) => {
      event.appMutation!.scope = { tenant: { tenantId: "Upper" } };
    }],
    ["invalid App user account", (event) => {
      event.appMutation!.scope = {
        user: {
          tenantId: "tenant",
          accountPrincipalId: "agent:owner"
        }
      };
    }],
    ["empty App Placement ID", (event) => {
      event.appMutation!.placementId = "";
    }],
    ["invalid App Package ID", (event) => {
      event.appMutation!.packageId = "Upper";
    }],
    ["zero App Package generation", (event) => {
      event.appMutation!.packageGeneration = 0n;
    }],
    ["App action unspecified", (event) => {
      event.appMutation!.action =
        AppMutationAction.APP_MUTATION_ACTION_UNSPECIFIED;
    }],
    ["App action unknown", (event) => {
      event.appMutation!.action = 99 as AppMutationAction;
    }],
    ["created App revision", (event) => {
      event.appMutation!.appRevision = 2n;
    }],
    ["updated App revision", (event) => {
      event.appMutation!.action =
        AppMutationAction
          .APP_MUTATION_ACTION_PACKAGE_GENERATION_CHANGED;
      event.appMutation!.appRevision = 1n;
    }]
  ]);
});

test("validates Configuration and Secret publication details", async () => {
  for (const detail of [
    "configurationPublication",
    "secretPublication"
  ] as const) {
    const publication = admitted("configd", detail);
    await rejectCases(publication, [
      ["missing publication target", (event) => {
        event[detail]!.target = undefined;
      }],
      ["empty publication ID", (event) => {
        const target = event[detail]!.target!;
        if ("configurationId" in target) {
          target.configurationId = "";
        } else {
          target.secretId = "";
        }
      }],
      ["invalid publication version", (event) => {
        const target = event[detail]!.target!;
        if ("configurationVersionId" in target) {
          target.configurationVersionId = "Upper";
        } else {
          target.secretVersionId = "Upper";
        }
      }],
      ["missing consumer binding", (event) => {
        event[detail]!.binding = undefined;
      }],
      ["missing binding target", (event) => {
        event[detail]!.binding!.placementTarget = undefined;
      }],
      ["invalid binding Placement ID", (event) => {
        event[detail]!.binding!.placementId = "bad.dot";
      }],
      ["invalid binding consumer ID", (event) => {
        event[detail]!.binding!.consumerId = "";
      }],
      ["empty binding purpose", (event) => {
        event[detail]!.binding!.purpose = "";
      }],
      ["invalid binding purpose", (event) => {
        event[detail]!.binding!.purpose = "two__parts";
      }],
      ["overlong binding purpose", (event) => {
        event[detail]!.binding!.purpose = "a".repeat(65);
      }],
      ["zero identity revision", (event) => {
        event[detail]!.identityRevision = 0n;
      }],
      ["claim ID without revision", (event) => {
        event[detail]!.dependencyClaimId =
          `dpc-${"a".repeat(32)}`;
      }],
      ["claim revision without ID", (event) => {
        event[detail]!.dependencyClaimRevision = 1n;
      }],
      ["invalid claim ID", (event) => {
        event[detail]!.dependencyClaimId = "claim";
        event[detail]!.dependencyClaimRevision = 1n;
      }],
      ["zero claim revision", (event) => {
        event[detail]!.dependencyClaimId =
          `dpc-${"a".repeat(32)}`;
        event[detail]!.dependencyClaimRevision = 0n;
      }]
    ]);
  }
});

test("validates Projection mutation details", async () => {
  const projection = admitted("configd", "projectionMutation");
  await rejectCases(projection, [
    ["invalid Projection ID", (event) => {
      event.projectionMutation!.projectionId =
        `prj_${"1".repeat(52)}`;
    }],
    ["short Projection ID", (event) => {
      event.projectionMutation!.projectionId =
        `prj_${"a".repeat(51)}`;
    }],
    ["Projection action unspecified", (event) => {
      event.projectionMutation!.action =
        ProjectionMutationAction
          .PROJECTION_MUTATION_ACTION_UNSPECIFIED;
    }],
    ["Projection action unknown", (event) => {
      event.projectionMutation!.action =
        99 as ProjectionMutationAction;
    }],
    ["created Projection revision", (event) => {
      event.projectionMutation!.projectionRevision = 2n;
    }],
    ["missing Projection target", (event) => {
      event.projectionMutation!.configuration = undefined;
      event.projectionMutation!.secret = undefined;
    }],
    ["invalid Projection target ID", (event) => {
      event.projectionMutation!.configuration!
        .configurationId = "";
    }],
    ["invalid Projection target version", (event) => {
      event.projectionMutation!.configuration!
        .configurationVersionId = "Upper";
    }],
    ["missing Projection binding", (event) => {
      event.projectionMutation!.binding = undefined;
    }]
  ]);
});

test("validates Placement, Workload, and Run mutation details", async () => {
  const placement = admitted("execd", "placementMutation");
  await rejectCases(placement, [
    ["empty Placement ID", (event) => {
      event.placementMutation!.placementId = "";
    }],
    ["missing Placement target", (event) => {
      event.placementMutation!.target = undefined;
    }],
    ["Placement action unspecified", (event) => {
      event.placementMutation!.action =
        PlacementMutationAction
          .PLACEMENT_MUTATION_ACTION_UNSPECIFIED;
    }],
    ["Placement action unknown", (event) => {
      event.placementMutation!.action =
        99 as PlacementMutationAction;
    }],
    ["created Placement revision", (event) => {
      event.placementMutation!.placementRevision = 2n;
    }],
    ["Placement state unspecified", (event) => {
      event.placementMutation!.resultingDesiredState =
        ExecutionDesiredState.EXECUTION_DESIRED_STATE_UNSPECIFIED;
    }],
    ["Placement state unknown", (event) => {
      event.placementMutation!.resultingDesiredState =
        99 as ExecutionDesiredState;
    }]
  ]);

  const workload = admitted("execd", "workloadMutation");
  await rejectCases(workload, [
    ["empty Workload ID", (event) => {
      event.workloadMutation!.workloadId = "";
    }],
    ["invalid Workload Placement ID", (event) => {
      event.workloadMutation!.placementId = "bad.dot";
    }],
    ["missing Workload target", (event) => {
      event.workloadMutation!.placementTarget = undefined;
    }],
    ["Workload action unspecified", (event) => {
      event.workloadMutation!.action =
        WorkloadMutationAction
          .WORKLOAD_MUTATION_ACTION_UNSPECIFIED;
    }],
    ["updated Workload revision", (event) => {
      event.workloadMutation!.action =
        WorkloadMutationAction.WORKLOAD_MUTATION_ACTION_UPDATED;
      event.workloadMutation!.workloadRevision = 1n;
    }],
    ["zero Workload App revision", (event) => {
      event.workloadMutation!.appRevision = 0n;
    }],
    ["invalid Workload Package ID", (event) => {
      event.workloadMutation!.packageId = "Upper";
    }],
    ["zero Workload Package generation", (event) => {
      event.workloadMutation!.packageGeneration = 0n;
    }],
    ["invalid Workload component ID", (event) => {
      event.workloadMutation!.componentId = "bad.dot";
    }]
  ]);

  const run = admitted("execd", "runMutation");
  await rejectCases(run, [
    ["empty Run ID", (event) => {
      event.runMutation!.runId = "";
    }],
    ["overlong Run ID", (event) => {
      event.runMutation!.runId = "a".repeat(129);
    }],
    ["invalid Run Workload ID", (event) => {
      event.runMutation!.workloadId = "bad.dot";
    }],
    ["invalid Run Placement ID", (event) => {
      event.runMutation!.placementId = "";
    }],
    ["missing Run target", (event) => {
      event.runMutation!.placementTarget = undefined;
    }],
    ["Run action unspecified", (event) => {
      event.runMutation!.action =
        RunMutationAction.RUN_MUTATION_ACTION_UNSPECIFIED;
    }],
    ["cancelled Run revision", (event) => {
      event.runMutation!.action =
        RunMutationAction
          .RUN_MUTATION_ACTION_CANCELLATION_REQUESTED;
      event.runMutation!.runRevision = 1n;
    }],
    ["invalid configured Run Actor", (event) => {
      event.runMutation!.configuredActorPrincipalId = "group:bad";
    }]
  ]);
});

function admitted(
  sourceName: string,
  detail: AuditDetailField
): AdmittedAuditEvent {
  return findAdmittedAuditEvent(
    getAuditdTestContext(),
    sourceName,
    detail);
}

async function rejectCases(
  admittedEvent: AdmittedAuditEvent,
  cases: readonly (readonly [string, Mutate])[]
): Promise<void> {
  for (const [name, mutate] of cases) {
    const event = cloneEvent(admittedEvent.event);
    mutate(event);
    await assert.rejects(
      recordAuditBatch(
        getAuditdTestContext(),
        admittedEvent.workload,
        [event]),
      matchGrpcStatus(status.INVALID_ARGUMENT),
      name);
  }
}

function cloneEvent(event: AuditEvent): AuditEvent {
  return structuredClone(event);
}
