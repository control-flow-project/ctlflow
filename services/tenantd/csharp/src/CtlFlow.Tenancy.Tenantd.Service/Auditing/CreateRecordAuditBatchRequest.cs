using CtlFlow.Audit.V1;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using Google.Protobuf.WellKnownTypes;

namespace CtlFlow.Tenancy.Tenantd.Service.Auditing;

internal static partial class AuditDelivery
{
    private const ulong SourceSchemaGeneration = 1;

    internal static ValueTask<RecordAuditBatchRequest>
        CreateRecordAuditBatchRequest(
            AuditIntent intent,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var target = CreateTarget(intent.Target);
        var detail = new TenancyMutationAuditDetail
        {
            ResourceRevision = checked((ulong)intent.ResultingRevision.Value),
            Outcome = CtlFlow.Audit.V1.AuditOutcome.Succeeded,
            ResultingState = MapState(intent.ResultingState)
        };
        switch (target)
        {
            case TenantAuditTarget tenant:
                detail.Tenant = tenant;
                break;
            case WorkspaceAuditTarget workspace:
                detail.Workspace = workspace;
                break;
            default:
                throw new InvalidOperationException("Audit target is invalid");
        }

        var request = new RecordAuditBatchRequest
        {
            SourceSchemaGeneration = SourceSchemaGeneration
        };
        request.Events.Add(new AuditEvent
        {
            SourceEventId = intent.EventId.Value,
            IdempotencyKey = intent.EventId.Value,
            Operation = MapOperation(intent.Operation),
            OccurredAt = Timestamp.FromDateTimeOffset(intent.OccurredAt.Value),
            Attribution = CreateAttribution(intent.Attribution),
            Partition = new AuditPartition
            {
                Tenant = new TenantAuditPartition
                {
                    TenantId = GetTenantId(intent.Target)
                }
            },
            TraceId = intent.Correlation.TraceId,
            SpanId = intent.Correlation.SpanId,
            TenancyMutation = detail
        });
        return ValueTask.FromResult(request);
    }

    private static CtlFlow.Audit.V1.AuditAttribution CreateAttribution(
        Domain.Auditing.AuditAttribution attribution) =>
        attribution switch
        {
            Domain.Auditing.AuditAttribution.Kubernetes kubernetes =>
                new CtlFlow.Audit.V1.AuditAttribution
                {
                    KubernetesSubject = kubernetes.Subject.Value
                },
            Domain.Auditing.AuditAttribution.AttachedActor attached =>
                new CtlFlow.Audit.V1.AuditAttribution
                {
                    AttachedActor = new AttachedActor
                    {
                        ActorPrincipalId =
                            attached.ActorPrincipal.Value,
                        AttachedAccountPrincipalId =
                            attached.AttachedAccountPrincipal.Value
                    },
                    ImmediateCaller = attached.ImmediateCaller.Value
                },
            _ => throw new InvalidOperationException(
                "Audit attribution is invalid")
        };

    private static object CreateTarget(AuditTarget target) =>
        target switch
        {
            AuditTarget.Tenant tenant => new TenantAuditTarget
            {
                TenantId = tenant.TenantId.Value
            },
            AuditTarget.Workspace workspace => new WorkspaceAuditTarget
            {
                TenantId = workspace.TenantId.Value,
                WorkspaceId = workspace.WorkspaceId.Value
            },
            _ => throw new InvalidOperationException("Audit target is invalid")
        };

    private static string GetTenantId(AuditTarget target) =>
        target switch
        {
            AuditTarget.Tenant tenant => tenant.TenantId.Value,
            AuditTarget.Workspace workspace => workspace.TenantId.Value,
            _ => throw new InvalidOperationException("Audit target is invalid")
        };

    private static string MapOperation(AuditOperation operation) =>
        operation switch
        {
            AuditOperation.CreateTenant => "create_tenant",
            AuditOperation.UpdateTenant => "update_tenant",
            AuditOperation.SetTenantState => "set_tenant_state",
            AuditOperation.CreateWorkspace => "create_workspace",
            AuditOperation.UpdateWorkspace => "update_workspace",
            AuditOperation.SetWorkspaceState => "set_workspace_state",
            _ => throw new InvalidOperationException(
                "Audit operation is invalid")
        };

    private static TenancyResourceState MapState(
        Domain.Resources.ResourceState state) =>
        state switch
        {
            Domain.Resources.ResourceState.Active =>
                TenancyResourceState.Active,
            Domain.Resources.ResourceState.Suspended =>
                TenancyResourceState.Suspended,
            Domain.Resources.ResourceState.Deleted =>
                TenancyResourceState.Deleted,
            _ => throw new InvalidOperationException(
                "Audit state is invalid")
        };
}
