using CtlFlow.Audit.V1;
using CtlFlow.Packages.Pkgd.Domain.Apps;
using CtlFlow.Packages.Pkgd.Domain.Auditing;
using Google.Protobuf.WellKnownTypes;
using DomainAuditAttribution =
    CtlFlow.Packages.Pkgd.Domain.Auditing.AuditAttribution;

namespace CtlFlow.Packages.Pkgd.Service.Auditing;

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
            case AuditIntent.PackageDeclaration declaration:
                auditEvent.PackageDeclaration =
                    new PackageDeclarationAuditDetail
                    {
                        PackageId = declaration.PackageId.Value,
                        Generation = checked(
                            (ulong)declaration.Generation.Value)
                    };
                break;
            case AuditIntent.AppMutation app:
                auditEvent.AppMutation = new AppMutationAuditDetail
                {
                    AppId = app.AppId.Value,
                    Scope = CreatePlacementTarget(app.Scope),
                    PlacementId = app.PlacementId.Value,
                    PackageId = app.PackageId.Value,
                    PackageGeneration = checked(
                        (ulong)app.PackageGeneration.Value),
                    AppRevision = checked((ulong)app.AppRevision.Value),
                    Action = MapAction(app.Action)
                };
                break;
            default:
                throw new InvalidOperationException(
                    "Pkgd audit intent is invalid");
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
                "Pkgd audit attribution is invalid")
        };

    private static AuditPartition CreatePartition(AuditIntent intent) =>
        intent switch
        {
            AuditIntent.PackageDeclaration => new AuditPartition
            {
                Global = new GlobalAuditPartition()
            },
            AuditIntent.AppMutation
            {
                Scope: AppScope.Global
            } => new AuditPartition
            {
                Global = new GlobalAuditPartition()
            },
            AuditIntent.AppMutation app => new AuditPartition
            {
                Tenant = new TenantAuditPartition
                {
                    TenantId = GetTenantId(app.Scope)
                }
            },
            _ => throw new InvalidOperationException(
                "Pkgd audit partition is invalid")
        };

    private static string GetTenantId(AppScope scope) =>
        scope switch
        {
            AppScope.Tenant tenant => tenant.TenantId.Value,
            AppScope.Workspace workspace => workspace.TenantId.Value,
            AppScope.User user => user.TenantId.Value,
            _ => throw new InvalidOperationException(
                "Global App has no Tenant audit partition")
        };

    private static PlacementAuditTarget CreatePlacementTarget(
        AppScope scope) =>
        scope switch
        {
            AppScope.Global => new PlacementAuditTarget
            {
                Global = new GlobalPlacementAuditTarget()
            },
            AppScope.Tenant tenant => new PlacementAuditTarget
            {
                Tenant = new TenantPlacementAuditTarget
                {
                    TenantId = tenant.TenantId.Value
                }
            },
            AppScope.Workspace workspace => new PlacementAuditTarget
            {
                Workspace = new WorkspacePlacementAuditTarget
                {
                    TenantId = workspace.TenantId.Value,
                    WorkspaceId = workspace.WorkspaceId.Value
                }
            },
            AppScope.User user => new PlacementAuditTarget
            {
                User = new UserPlacementAuditTarget
                {
                    TenantId = user.TenantId.Value,
                    AccountPrincipalId = user.AccountPrincipalId.Value
                }
            },
            _ => throw new InvalidOperationException(
                "App scope is invalid")
        };

    private static AppMutationAction MapAction(AppAuditAction value) =>
        value switch
        {
            AppAuditAction.Created => AppMutationAction.Created,
            AppAuditAction.PackageGenerationChanged =>
                AppMutationAction.PackageGenerationChanged,
            _ => throw new InvalidOperationException(
                "App audit action is invalid")
        };
}
