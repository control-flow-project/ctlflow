using CtlFlow.Audit.V1;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using Google.Protobuf.WellKnownTypes;

namespace CtlFlow.Tenancy.Tenantd.Service.Auditing;

internal static partial class AuditDelivery
{
    internal static ValueTask<RecordAuditBatchRequest>
        CreateRecordAuditBatchRequest(
            AuditIntent intent,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var auditEvent = new AuditEvent
        {
            SourceEventId = intent.EventId.Value,
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
            SpanId = intent.Correlation.SpanId
        };

        switch (intent.Target)
        {
            case AuditTarget.Tenant:
                auditEvent.TenantMutation = new TenantMutationAuditDetail
                {
                    Action = MapTenantAction(intent.Operation),
                    ResourceRevision = checked(
                        (ulong)intent.ResultingRevision.Value),
                    ResultingState = MapState(intent.ResultingState)
                };
                break;
            case AuditTarget.Workspace workspace:
                auditEvent.WorkspaceMutation =
                    new WorkspaceMutationAuditDetail
                    {
                        WorkspaceId = workspace.WorkspaceId.Value,
                        Action = MapWorkspaceAction(intent.Operation),
                        ResourceRevision = checked(
                            (ulong)intent.ResultingRevision.Value),
                        ResultingState = MapState(intent.ResultingState)
                    };
                break;
            default:
                throw new InvalidOperationException("Audit target is invalid");
        }

        var request = new RecordAuditBatchRequest();
        request.Events.Add(auditEvent);
        return ValueTask.FromResult(request);
    }

    private static CtlFlow.Audit.V1.AuditAttribution CreateAttribution(
        Domain.Auditing.AuditAttribution attribution) =>
        attribution switch
        {
            Domain.Auditing.AuditAttribution.Kubernetes certificate =>
                new CtlFlow.Audit.V1.AuditAttribution
                {
                    OperatorCommonName = certificate.Subject.Value
                },
            Domain.Auditing.AuditAttribution.AttachedActor invocation =>
                new CtlFlow.Audit.V1.AuditAttribution
                {
                    Invocation = new InvocationAuditAttribution
                    {
                        ActorPrincipalId =
                            invocation.ActorPrincipal.Value,
                        AttachedAccountPrincipalId =
                            invocation.AttachedAccountPrincipal.Value,
                        WorkloadSubject =
                            invocation.ImmediateCaller.Value
                    }
                },
            _ => throw new InvalidOperationException(
                "Audit attribution is invalid")
        };

    private static string GetTenantId(AuditTarget target) =>
        target switch
        {
            AuditTarget.Tenant tenant => tenant.TenantId.Value,
            AuditTarget.Workspace workspace => workspace.TenantId.Value,
            _ => throw new InvalidOperationException("Audit target is invalid")
        };

    private static TenantMutationAction MapTenantAction(
        AuditOperation operation) =>
        operation switch
        {
            AuditOperation.CreateTenant =>
                TenantMutationAction.CreateTenant,
            AuditOperation.UpdateTenant =>
                TenantMutationAction.UpdateTenant,
            AuditOperation.SetTenantState =>
                TenantMutationAction.SetTenantState,
            _ => throw new InvalidOperationException(
                "Tenant audit action is invalid")
        };

    private static WorkspaceMutationAction MapWorkspaceAction(
        AuditOperation operation) =>
        operation switch
        {
            AuditOperation.CreateWorkspace =>
                WorkspaceMutationAction.CreateWorkspace,
            AuditOperation.UpdateWorkspace =>
                WorkspaceMutationAction.UpdateWorkspace,
            AuditOperation.SetWorkspaceState =>
                WorkspaceMutationAction.SetWorkspaceState,
            _ => throw new InvalidOperationException(
                "Workspace audit action is invalid")
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
