using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;
using CtlFlow.Configuration.Configd.Domain.Secrets;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Configuration.Configd.Db.Secrets;

public static partial class Secrets
{
    internal static async Task<SecretMetadata?> QuerySecretMetadata(
        ConfigurationDatabase configurationDatabase,
        SecretId secretId,
        CancellationToken cancellation)
    {
        await using var database =
            await configurationDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        var id = secretId.Value;
        var queryCancellation = cancellation;
        var row = await database.Secrets
            .AsNoTracking()
            .Where(value => EF.Property<string>(value, "_secretId") == id)
            .Select(value => new
            {
                SecretId = EF.Property<string>(value, "_secretId"),
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
                CurrentVersionId =
                    EF.Property<string>(value, "_currentSecretVersionId"),
                Revision = EF.Property<long>(value, "_revision"),
                value.CreatedAt,
                value.UpdatedAt
            })
            .SingleOrDefaultAsync(queryCancellation);
        if (row is null)
        {
            return null;
        }

        return new SecretMetadata(
            SecretId.FromStorage(row.SecretId),
            BindingStorage.FromStorage(
                row.ScopeKind,
                row.PlacementId,
                row.TenantId,
                row.WorkspaceId,
                row.AccountPrincipalId,
                row.ConsumerId,
                row.Purpose),
            SecretVersionId.FromStorage(row.CurrentVersionId),
            Revision.FromStorage(row.Revision),
            row.CreatedAt,
            row.UpdatedAt);
    }
}
