using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Domain.Auditing;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Projections;
using CtlFlow.Configuration.Configd.Domain.Revisions;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Configuration.Configd.Domain.Projections.Projections;

namespace CtlFlow.Configuration.Configd.Db.Projections;

public static partial class Projections
{
    internal static async Task<Projection?> QueryProjection(
        ConfigurationDatabase configurationDatabase,
        ProjectionDataKind kind,
        ConsumerBinding binding,
        CancellationToken cancellation)
    {
        await using var database =
            await configurationDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        var scopeKind = BindingStorage.GetScopeKind(binding);
        var placementId = binding.Placement.PlacementId.Value;
        var tenantId = BindingStorage.GetTenantId(binding);
        var workspaceId = BindingStorage.GetWorkspaceId(binding);
        var accountPrincipalId =
            BindingStorage.GetAccountPrincipalId(binding);
        var consumerId = binding.ConsumerId.Value;
        var purpose = binding.Purpose.Value;
        var dataKind = (int)kind;
        var queryCancellation = cancellation;
        var row = await database.Projections
            .AsNoTracking()
            .Where(value =>
                EF.Property<int>(value, "_dataKind") == dataKind
                && EF.Property<int>(value, "_scopeKind") == scopeKind
                && EF.Property<string>(value, "_placementId") == placementId
                && EF.Property<string?>(value, "_tenantId") == tenantId
                && EF.Property<string?>(value, "_workspaceId") == workspaceId
                && EF.Property<string?>(
                    value,
                    "_accountPrincipalId") == accountPrincipalId
                && EF.Property<string>(value, "_consumerId") == consumerId
                && EF.Property<string>(value, "_purpose") == purpose)
            .Select(value => new
            {
                ProjectionId =
                    EF.Property<string>(value, "_projectionId"),
                DataKind = EF.Property<int>(value, "_dataKind"),
                TargetIdentityId =
                    EF.Property<string>(value, "_targetIdentityId"),
                CurrentTargetVersionId = EF.Property<string>(
                    value,
                    "_currentTargetVersionId"),
                Revision = EF.Property<long>(value, "_revision"),
                AuditEventId =
                    EF.Property<string>(value, "_auditEventId"),
                value.CreatedAt,
                value.UpdatedAt
            })
            .SingleOrDefaultAsync(queryCancellation);
        if (row is null)
        {
            return null;
        }

        ProjectionTarget target = row.DataKind switch
        {
            (int)ProjectionDataKind.Configuration =>
                new ProjectionTarget.Configuration(
                    ConfigurationId.FromStorage(row.TargetIdentityId),
                    ConfigurationVersionId.FromStorage(
                        row.CurrentTargetVersionId)),
            (int)ProjectionDataKind.Secret =>
                new ProjectionTarget.Secret(
                    SecretId.FromStorage(row.TargetIdentityId),
                    SecretVersionId.FromStorage(
                        row.CurrentTargetVersionId)),
            _ => throw new InvalidOperationException(
                "Stored projection kind is invalid")
        };
        return await RestoreProjection(
            new ProjectionMetadata(
                ProjectionId.FromStorage(row.ProjectionId),
                target,
                binding,
                Revision.FromStorage(row.Revision),
                row.CreatedAt,
                row.UpdatedAt),
            AuditEventId.FromStorage(row.AuditEventId),
            cancellation);
    }
}
