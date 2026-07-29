using CtlFlow.Audit.V1;
using CtlFlow.Execution.Execd.Domain.Auditing;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using Google.Protobuf.WellKnownTypes;
using DomainAuditAttribution =
    CtlFlow.Execution.Execd.Domain.Auditing.AuditAttribution;

namespace CtlFlow.Execution.Execd.Service.Auditing;

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
            Partition = CreatePartition(intent),
            TraceId = intent.Correlation.TraceId,
            SpanId = intent.Correlation.SpanId
        };

        switch (intent)
        {
            case AuditIntent.PlacementMutation placement:
                auditEvent.PlacementMutation =
                    new PlacementMutationAuditDetail
                    {
                        PlacementId = placement.PlacementId.Value,
                        Target = CreatePlacementTarget(placement.Target),
                        Action = MapAction(placement.Action),
                        PlacementRevision = checked(
                            (ulong)placement.Revision.Value),
                        ResultingDesiredState = MapState(
                            placement.DesiredState)
                    };
                break;
            case AuditIntent.WorkloadMutation workload:
                auditEvent.WorkloadMutation =
                    new WorkloadMutationAuditDetail
                    {
                        WorkloadId = workload.WorkloadId.Value,
                        PlacementId = workload.PlacementId.Value,
                        PlacementTarget =
                            CreatePlacementTarget(workload.Target),
                        Action = MapAction(workload.Action),
                        WorkloadRevision = checked(
                            (ulong)workload.Revision.Value),
                        ResultingDesiredState = MapState(
                            workload.DesiredState),
                        AppId = workload.AppId.Value,
                        AppRevision = checked(
                            (ulong)workload.AppRevision.Value),
                        PackageId = workload.PackageId.Value,
                        PackageGeneration = checked(
                            (ulong)workload.PackageGeneration.Value),
                        ComponentId = workload.ComponentId.Value
                    };
                break;
            case AuditIntent.RunMutation run:
                auditEvent.RunMutation = new RunMutationAuditDetail
                {
                    RunId = run.RunId.Value,
                    WorkloadId = run.WorkloadId.Value,
                    PlacementId = run.PlacementId.Value,
                    PlacementTarget =
                        CreatePlacementTarget(run.Target),
                    Action = MapAction(run.Action),
                    RunRevision = checked((ulong)run.Revision.Value)
                };
                if (run.ActorPrincipalId is not null)
                {
                    auditEvent.RunMutation.ConfiguredActorPrincipalId =
                        run.ActorPrincipalId.Value;
                }

                break;
            default:
                throw new InvalidOperationException(
                    "Execd audit intent is invalid");
        }

        var request = new RecordAuditBatchRequest();
        request.Events.Add(auditEvent);
        return ValueTask.FromResult(request);
    }

    private static CtlFlow.Audit.V1.AuditAttribution CreateAttribution(
        DomainAuditAttribution attribution) =>
        attribution switch
        {
            DomainAuditAttribution.Operator item =>
                new CtlFlow.Audit.V1.AuditAttribution
                {
                    OperatorCommonName = item.CommonName.Value
                },
            DomainAuditAttribution.Invocation item =>
                new CtlFlow.Audit.V1.AuditAttribution
                {
                    Invocation = new InvocationAuditAttribution
                    {
                        ActorPrincipalId = item.ActorPrincipal.Value,
                        AttachedAccountPrincipalId =
                            item.AttachedAccountPrincipal.Value,
                        WorkloadSubject = item.WorkloadSubject.Value
                    }
                },
            _ => throw new InvalidOperationException(
                "Execd audit attribution is invalid")
        };

    private static AuditPartition CreatePartition(AuditIntent intent)
    {
        var target = intent switch
        {
            AuditIntent.PlacementMutation item => item.Target,
            AuditIntent.WorkloadMutation item => item.Target,
            AuditIntent.RunMutation item => item.Target,
            _ => throw new InvalidOperationException(
                "Execd audit intent is invalid")
        };
        return target switch
        {
            PlacementTarget.Global => new AuditPartition
            {
                Global = new GlobalAuditPartition()
            },
            _ => new AuditPartition
            {
                Tenant = new TenantAuditPartition
                {
                    TenantId = target.TenantAnchor!.Value
                }
            }
        };
    }

    private static PlacementAuditTarget CreatePlacementTarget(
        PlacementTarget target) =>
        target switch
        {
            PlacementTarget.Global => new PlacementAuditTarget
            {
                Global = new GlobalPlacementAuditTarget()
            },
            PlacementTarget.Tenant tenant => new PlacementAuditTarget
            {
                Tenant = new TenantPlacementAuditTarget
                {
                    TenantId = tenant.TenantId.Value
                }
            },
            PlacementTarget.Workspace workspace =>
                new PlacementAuditTarget
                {
                    Workspace = new WorkspacePlacementAuditTarget
                    {
                        TenantId = workspace.TenantId.Value,
                        WorkspaceId = workspace.WorkspaceId.Value
                    }
                },
            PlacementTarget.User user => new PlacementAuditTarget
            {
                User = new UserPlacementAuditTarget
                {
                    TenantId = user.TenantId.Value,
                    AccountPrincipalId =
                        user.AccountPrincipalId.Value
                }
            },
            _ => throw new InvalidOperationException(
                "Placement target is invalid")
        };

    private static PlacementMutationAction MapAction(
        PlacementAuditAction action) =>
        action switch
        {
            PlacementAuditAction.Declared =>
                PlacementMutationAction.Declared,
            PlacementAuditAction.Updated =>
                PlacementMutationAction.Updated,
            _ => throw new InvalidOperationException(
                "Placement audit action is invalid")
        };

    private static WorkloadMutationAction MapAction(
        WorkloadAuditAction action) =>
        action switch
        {
            WorkloadAuditAction.Declared =>
                WorkloadMutationAction.Declared,
            WorkloadAuditAction.Updated =>
                WorkloadMutationAction.Updated,
            _ => throw new InvalidOperationException(
                "Workload audit action is invalid")
        };

    private static RunMutationAction MapAction(RunAuditAction action) =>
        action switch
        {
            RunAuditAction.Created => RunMutationAction.Created,
            RunAuditAction.CancellationRequested =>
                RunMutationAction.CancellationRequested,
            _ => throw new InvalidOperationException(
                "Run audit action is invalid")
        };

    private static ExecutionDesiredState MapState(DesiredState state) =>
        state switch
        {
            DesiredState.Active => ExecutionDesiredState.Active,
            DesiredState.Suspended => ExecutionDesiredState.Suspended,
            DesiredState.Retired => ExecutionDesiredState.Retired,
            _ => throw new InvalidOperationException(
                "Desired state is invalid")
        };
}
