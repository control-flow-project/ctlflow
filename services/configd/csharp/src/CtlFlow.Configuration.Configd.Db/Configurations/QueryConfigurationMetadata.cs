using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Configurations;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;
using CtlFlow.Configuration.Configd.Domain.Time;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Configuration.Configd.Db.Configurations;

public static partial class Configurations
{
    internal static async Task<ConfigurationMetadata?>
        QueryConfigurationMetadata(
            ConfigurationDatabase configurationDatabase,
            ConfigurationId configurationId,
            CancellationToken cancellation)
    {
        await using var database =
            await configurationDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        var id = configurationId.Value;
        var queryCancellation = cancellation;
        var row = await database.Configurations
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_configurationId") == id)
            .Select(value => new
            {
                ConfigurationId =
                    EF.Property<string>(value, "_configurationId"),
                ScopeKind = EF.Property<int>(value, "_scopeKind"),
                PlacementId =
                    EF.Property<string>(value, "_placementId"),
                TenantId = EF.Property<string?>(value, "_tenantId"),
                WorkspaceId =
                    EF.Property<string?>(value, "_workspaceId"),
                AccountPrincipalId =
                    EF.Property<string?>(value, "_accountPrincipalId"),
                ConsumerId = EF.Property<string>(value, "_consumerId"),
                Purpose = EF.Property<string>(value, "_purpose"),
                CurrentVersionId = EF.Property<string>(
                    value,
                    "_currentConfigurationVersionId"),
                Revision = EF.Property<long>(value, "_revision"),
                value.CreatedAt,
                value.UpdatedAt
            })
            .SingleOrDefaultAsync(queryCancellation);
        if (row is null)
        {
            return null;
        }

        return new ConfigurationMetadata(
            ConfigurationId.FromStorage(row.ConfigurationId),
            BindingStorage.FromStorage(
                row.ScopeKind,
                row.PlacementId,
                row.TenantId,
                row.WorkspaceId,
                row.AccountPrincipalId,
                row.ConsumerId,
                row.Purpose),
            ConfigurationVersionId.FromStorage(row.CurrentVersionId),
            Revision.FromStorage(row.Revision),
            row.CreatedAt,
            row.UpdatedAt);
    }
}
