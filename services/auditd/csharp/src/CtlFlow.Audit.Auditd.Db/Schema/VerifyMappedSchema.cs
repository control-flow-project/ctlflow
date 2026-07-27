using CtlFlow.Audit.Auditd.Db.Providers;
using CtlFlow.Audit.Auditd.Domain.Events;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Audit.Auditd.Db.Schema;

public static partial class Schemas
{
    private static async Task VerifyMappedSchema(
        AuditDatabase auditDatabase,
        CancellationToken cancellation)
    {
        await using var database =
            await auditDatabase.Contexts.CreateDbContextAsync(cancellation);
        var queryCancellation = cancellation;

        await database.AuditEvents
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "EventKey"))
            .Select(value => new
            {
                EventKey = EF.Property<string>(value, "EventKey"),
                SourcePrincipal =
                    EF.Property<string>(value, "SourcePrincipal"),
                SourceSubject = EF.Property<string>(value, "SourceSubject"),
                SourceEventId = EF.Property<string>(value, "SourceEventId"),
                OccurredAtSeconds =
                    EF.Property<long>(value, "OccurredAtSeconds"),
                OccurredAtNanoseconds =
                    EF.Property<int>(value, "OccurredAtNanoseconds"),
                AttributionKind =
                    EF.Property<AuditAttributionKind>(
                        value,
                        "AttributionKind"),
                OperatorCommonName =
                    EF.Property<string?>(value, "OperatorCommonName"),
                WorkloadSubject =
                    EF.Property<string?>(value, "WorkloadSubject"),
                ActorPrincipalId =
                    EF.Property<string?>(value, "ActorPrincipalId"),
                AttachedAccountPrincipalId =
                    EF.Property<string?>(
                        value,
                        "AttachedAccountPrincipalId"),
                InvocationWorkloadSubject =
                    EF.Property<string?>(
                        value,
                        "InvocationWorkloadSubject"),
                PartitionKind =
                    EF.Property<AuditPartitionKind>(value, "PartitionKind"),
                PartitionTenantId =
                    EF.Property<string?>(value, "PartitionTenantId"),
                PartitionKey = EF.Property<string>(value, "PartitionKey"),
                TraceId = EF.Property<string>(value, "TraceId"),
                SpanId = EF.Property<string>(value, "SpanId"),
                DetailKind =
                    EF.Property<AuditDetailKind>(value, "DetailKind"),
                ContentHash = EF.Property<string>(value, "ContentHash"),
                AcceptedAtSeconds =
                    EF.Property<long>(value, "AcceptedAtSeconds"),
                AcceptedAtNanoseconds =
                    EF.Property<int>(value, "AcceptedAtNanoseconds"),
                PartitionCursor =
                    EF.Property<long>(value, "PartitionCursor")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.PartitionHeads
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "PartitionKey"))
            .Select(value => new
            {
                PartitionKey = EF.Property<string>(value, "PartitionKey"),
                PartitionKind = EF.Property<int>(value, "PartitionKind"),
                TenantId = EF.Property<string?>(value, "TenantId"),
                CurrentCursor = EF.Property<long>(value, "CurrentCursor")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.TenantMutationDetails
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "EventKey"))
            .Select(value => new
            {
                EventKey = EF.Property<string>(value, "EventKey"),
                Action = EF.Property<int>(value, "Action"),
                ResourceRevision =
                    EF.Property<long>(value, "ResourceRevision"),
                ResultingState =
                    EF.Property<int>(value, "ResultingState")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.WorkspaceMutationDetails
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "EventKey"))
            .Select(value => new
            {
                EventKey = EF.Property<string>(value, "EventKey"),
                WorkspaceId = EF.Property<string>(value, "WorkspaceId"),
                Action = EF.Property<int>(value, "Action"),
                ResourceRevision =
                    EF.Property<long>(value, "ResourceRevision"),
                ResultingState =
                    EF.Property<int>(value, "ResultingState")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.IdentitySessionDetails
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "EventKey"))
            .Select(value => new
            {
                EventKey = EF.Property<string>(value, "EventKey"),
                SessionId = EF.Property<string>(value, "SessionId"),
                HumanAccountPrincipalId =
                    EF.Property<string>(
                        value,
                        "HumanAccountPrincipalId"),
                SessionRevision =
                    EF.Property<long>(value, "SessionRevision"),
                Action = EF.Property<int>(value, "Action")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.PackageDeclarationDetails
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "EventKey"))
            .Select(value => new
            {
                EventKey = EF.Property<string>(value, "EventKey"),
                PackageId = EF.Property<string>(value, "PackageId"),
                Generation = EF.Property<long>(value, "Generation")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.AppMutationDetails
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "EventKey"))
            .Select(value => new
            {
                EventKey = EF.Property<string>(value, "EventKey"),
                AppId = EF.Property<string>(value, "AppId"),
                ScopeKind =
                    EF.Property<PlacementTargetKind>(value, "ScopeKind"),
                ScopeTenantId =
                    EF.Property<string?>(value, "ScopeTenantId"),
                ScopeWorkspaceId =
                    EF.Property<string?>(value, "ScopeWorkspaceId"),
                ScopeAccountPrincipalId =
                    EF.Property<string?>(
                        value,
                        "ScopeAccountPrincipalId"),
                PlacementId = EF.Property<string>(value, "PlacementId"),
                PackageId = EF.Property<string>(value, "PackageId"),
                PackageGeneration =
                    EF.Property<long>(value, "PackageGeneration"),
                AppRevision = EF.Property<long>(value, "AppRevision"),
                Action = EF.Property<int>(value, "Action")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.ConfigurationPublicationDetails
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "EventKey"))
            .Select(value => new
            {
                EventKey = EF.Property<string>(value, "EventKey"),
                ConfigurationId =
                    EF.Property<string>(value, "ConfigurationId"),
                ConfigurationVersionId =
                    EF.Property<string>(
                        value,
                        "ConfigurationVersionId"),
                BindingPlacementId =
                    EF.Property<string>(value, "BindingPlacementId"),
                BindingTargetKind =
                    EF.Property<PlacementTargetKind>(
                        value,
                        "BindingTargetKind"),
                BindingTenantId =
                    EF.Property<string?>(value, "BindingTenantId"),
                BindingWorkspaceId =
                    EF.Property<string?>(value, "BindingWorkspaceId"),
                BindingAccountPrincipalId =
                    EF.Property<string?>(
                        value,
                        "BindingAccountPrincipalId"),
                BindingConsumerId =
                    EF.Property<string>(value, "BindingConsumerId"),
                BindingPurpose =
                    EF.Property<string>(value, "BindingPurpose"),
                IdentityRevision =
                    EF.Property<long>(value, "IdentityRevision"),
                DependencyClaimId =
                    EF.Property<string?>(value, "DependencyClaimId"),
                DependencyClaimRevision =
                    EF.Property<long?>(
                        value,
                        "DependencyClaimRevision")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.SecretPublicationDetails
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "EventKey"))
            .Select(value => new
            {
                EventKey = EF.Property<string>(value, "EventKey"),
                SecretId = EF.Property<string>(value, "SecretId"),
                SecretVersionId =
                    EF.Property<string>(value, "SecretVersionId"),
                BindingPlacementId =
                    EF.Property<string>(value, "BindingPlacementId"),
                BindingTargetKind =
                    EF.Property<PlacementTargetKind>(
                        value,
                        "BindingTargetKind"),
                BindingTenantId =
                    EF.Property<string?>(value, "BindingTenantId"),
                BindingWorkspaceId =
                    EF.Property<string?>(value, "BindingWorkspaceId"),
                BindingAccountPrincipalId =
                    EF.Property<string?>(
                        value,
                        "BindingAccountPrincipalId"),
                BindingConsumerId =
                    EF.Property<string>(value, "BindingConsumerId"),
                BindingPurpose =
                    EF.Property<string>(value, "BindingPurpose"),
                IdentityRevision =
                    EF.Property<long>(value, "IdentityRevision"),
                DependencyClaimId =
                    EF.Property<string?>(value, "DependencyClaimId"),
                DependencyClaimRevision =
                    EF.Property<long?>(
                        value,
                        "DependencyClaimRevision")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.ProjectionMutationDetails
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "EventKey"))
            .Select(value => new
            {
                EventKey = EF.Property<string>(value, "EventKey"),
                ProjectionId = EF.Property<string>(value, "ProjectionId"),
                Action = EF.Property<int>(value, "Action"),
                ProjectionRevision =
                    EF.Property<long>(value, "ProjectionRevision"),
                TargetKind =
                    EF.Property<ProjectionTargetKind>(value, "TargetKind"),
                ConfigurationId =
                    EF.Property<string?>(value, "ConfigurationId"),
                ConfigurationVersionId =
                    EF.Property<string?>(
                        value,
                        "ConfigurationVersionId"),
                SecretId = EF.Property<string?>(value, "SecretId"),
                SecretVersionId =
                    EF.Property<string?>(value, "SecretVersionId"),
                BindingPlacementId =
                    EF.Property<string>(value, "BindingPlacementId"),
                BindingTargetKind =
                    EF.Property<PlacementTargetKind>(
                        value,
                        "BindingTargetKind"),
                BindingTenantId =
                    EF.Property<string?>(value, "BindingTenantId"),
                BindingWorkspaceId =
                    EF.Property<string?>(value, "BindingWorkspaceId"),
                BindingAccountPrincipalId =
                    EF.Property<string?>(
                        value,
                        "BindingAccountPrincipalId"),
                BindingConsumerId =
                    EF.Property<string>(value, "BindingConsumerId"),
                BindingPurpose =
                    EF.Property<string>(value, "BindingPurpose")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.PlacementMutationDetails
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "EventKey"))
            .Select(value => new
            {
                EventKey = EF.Property<string>(value, "EventKey"),
                PlacementId = EF.Property<string>(value, "PlacementId"),
                TargetKind =
                    EF.Property<PlacementTargetKind>(value, "TargetKind"),
                TargetTenantId =
                    EF.Property<string?>(value, "TargetTenantId"),
                TargetWorkspaceId =
                    EF.Property<string?>(value, "TargetWorkspaceId"),
                TargetAccountPrincipalId =
                    EF.Property<string?>(
                        value,
                        "TargetAccountPrincipalId"),
                Action = EF.Property<int>(value, "Action"),
                PlacementRevision =
                    EF.Property<long>(value, "PlacementRevision"),
                ResultingDesiredState =
                    EF.Property<int>(value, "ResultingDesiredState")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.WorkloadMutationDetails
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "EventKey"))
            .Select(value => new
            {
                EventKey = EF.Property<string>(value, "EventKey"),
                WorkloadId = EF.Property<string>(value, "WorkloadId"),
                PlacementId = EF.Property<string>(value, "PlacementId"),
                TargetKind =
                    EF.Property<PlacementTargetKind>(value, "TargetKind"),
                TargetTenantId =
                    EF.Property<string?>(value, "TargetTenantId"),
                TargetWorkspaceId =
                    EF.Property<string?>(value, "TargetWorkspaceId"),
                TargetAccountPrincipalId =
                    EF.Property<string?>(
                        value,
                        "TargetAccountPrincipalId"),
                Action = EF.Property<int>(value, "Action"),
                WorkloadRevision =
                    EF.Property<long>(value, "WorkloadRevision"),
                ResultingDesiredState =
                    EF.Property<int>(value, "ResultingDesiredState"),
                AppId = EF.Property<string>(value, "AppId"),
                AppRevision = EF.Property<long>(value, "AppRevision"),
                PackageId = EF.Property<string>(value, "PackageId"),
                PackageGeneration =
                    EF.Property<long>(value, "PackageGeneration"),
                ComponentId = EF.Property<string>(value, "ComponentId")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.RunMutationDetails
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "EventKey"))
            .Select(value => new
            {
                EventKey = EF.Property<string>(value, "EventKey"),
                RunId = EF.Property<string>(value, "RunId"),
                WorkloadId = EF.Property<string>(value, "WorkloadId"),
                PlacementId = EF.Property<string>(value, "PlacementId"),
                TargetKind =
                    EF.Property<PlacementTargetKind>(value, "TargetKind"),
                TargetTenantId =
                    EF.Property<string?>(value, "TargetTenantId"),
                TargetWorkspaceId =
                    EF.Property<string?>(value, "TargetWorkspaceId"),
                TargetAccountPrincipalId =
                    EF.Property<string?>(
                        value,
                        "TargetAccountPrincipalId"),
                Action = EF.Property<int>(value, "Action"),
                RunRevision = EF.Property<long>(value, "RunRevision"),
                ConfiguredActorPrincipalId =
                    EF.Property<string?>(
                        value,
                        "ConfiguredActorPrincipalId")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
    }
}
