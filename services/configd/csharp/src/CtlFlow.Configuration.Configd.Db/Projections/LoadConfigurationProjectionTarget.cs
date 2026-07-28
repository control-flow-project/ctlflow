using CtlFlow.Configuration.Configd.Db.Content;
using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Projections;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Configuration.Configd.Db.Projections;

public static partial class Projections
{
    internal static async Task<ProjectionTargetLookup>
        LoadConfigurationProjectionTarget(
            ConfigurationDatabase configurationDatabase,
            ProjectionTarget.Configuration target,
            ConsumerBinding binding,
            CancellationToken cancellation)
    {
        await using var database =
            await configurationDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        var configurationId = target.ConfigurationId.Value;
        var versionId = target.VersionId.Value;
        var queryCancellation = cancellation;
        var row = await database.Set<ConfigurationVersionContentRow>()
            .AsNoTracking()
            .Join(
                database.Configurations.AsNoTracking(),
                version => EF.Property<string>(
                    version,
                    "ConfigurationId"),
                configuration => EF.Property<string>(
                    configuration,
                    "_configurationId"),
                (version, configuration) => new
                {
                    Version = version,
                    Configuration = configuration
                })
            .Where(value =>
                EF.Property<string>(
                    value.Version,
                    "ConfigurationId") == configurationId
                && EF.Property<string>(
                    value.Version,
                    "ConfigurationVersionId") == versionId)
            .Select(value => new
            {
                ContentJson = EF.Property<byte[]>(
                    value.Version,
                    "ContentJson"),
                ScopeKind = EF.Property<int>(
                    value.Configuration,
                    "_scopeKind"),
                PlacementId = EF.Property<string>(
                    value.Configuration,
                    "_placementId"),
                TenantId = EF.Property<string?>(
                    value.Configuration,
                    "_tenantId"),
                WorkspaceId = EF.Property<string?>(
                    value.Configuration,
                    "_workspaceId"),
                AccountPrincipalId = EF.Property<string?>(
                    value.Configuration,
                    "_accountPrincipalId"),
                ConsumerId = EF.Property<string>(
                    value.Configuration,
                    "_consumerId"),
                Purpose = EF.Property<string>(
                    value.Configuration,
                    "_purpose")
            })
            .SingleOrDefaultAsync(queryCancellation);
        if (row is null)
        {
            return new ProjectionTargetLookup(false, true, null);
        }

        var storedBinding = BindingStorage.FromStorage(
            row.ScopeKind,
            row.PlacementId,
            row.TenantId,
            row.WorkspaceId,
            row.AccountPrincipalId,
            row.ConsumerId,
            row.Purpose);
        return storedBinding == binding
            ? new ProjectionTargetLookup(
                true,
                true,
                new ProjectionPayloadLease.Configuration(
                    new ConfigurationContentLease(row.ContentJson)))
            : new ProjectionTargetLookup(false, true, null);
    }
}
