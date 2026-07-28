using CtlFlow.Configuration.Configd.Db.Content;
using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Configurations;
using CtlFlow.Configuration.Configd.Domain.Content;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;
using CtlFlow.Configuration.Configd.Domain.Time;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Configuration.Configd.Db.Configurations;

public static partial class Configurations
{
    public static async Task<ResolvedConfiguration?> ResolveConfiguration(
        ConfigurationDatabase configurationDatabase,
        ConfigurationId configurationId,
        ConfigurationVersionId versionId,
        ConsumerBinding binding,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = ConfigurationDbTelemetry.StartOperation(
            "resolve_configuration");
        await using var database =
            await configurationDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        var configurationValue = configurationId.Value;
        var versionValue = versionId.Value;
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
                    "ConfigurationVersionId") == versionValue
                && EF.Property<string>(
                    value.Version,
                    "ConfigurationId") == configurationValue)
            .Select(value => new
            {
                ConfigurationVersionId = EF.Property<string>(
                    value.Version,
                    "ConfigurationVersionId"),
                ConfigurationId = EF.Property<string>(
                    value.Version,
                    "ConfigurationId"),
                ContentJson = EF.Property<byte[]>(
                    value.Version,
                    "ContentJson"),
                ContentLength = EF.Property<int>(
                    value.Version,
                    "ContentLength"),
                ContentSha256 = EF.Property<byte[]>(
                    value.Version,
                    "ContentSha256"),
                VersionCreatedAt = EF.Property<long>(
                    value.Version,
                    "CreatedAtUnixMilliseconds"),
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
                    "_purpose"),
                CurrentVersionId = EF.Property<string>(
                    value.Configuration,
                    "_currentConfigurationVersionId"),
                Revision = EF.Property<long>(
                    value.Configuration,
                    "_revision"),
                value.Configuration.CreatedAt,
                value.Configuration.UpdatedAt
            })
            .SingleOrDefaultAsync(queryCancellation);
        cancellation.ThrowIfCancellationRequested();
        if (row is null)
        {
            return null;
        }

        var storedBinding = BindingStorage.FromStorage(
            row.ScopeKind,
            row.PlacementId,
            row.TenantId,
            row.WorkspaceId,
            row.AccountPrincipalId,
            row.ConsumerId,
            row.Purpose);
        if (storedBinding != binding)
        {
            return null;
        }

        return new ResolvedConfiguration(
            new ConfigurationMetadata(
                ConfigurationId.FromStorage(row.ConfigurationId),
                storedBinding,
                ConfigurationVersionId.FromStorage(row.CurrentVersionId),
                Revision.FromStorage(row.Revision),
                row.CreatedAt,
                row.UpdatedAt),
            new ConfigurationVersionMetadata(
                ConfigurationVersionId.FromStorage(
                    row.ConfigurationVersionId),
                ConfigurationId.FromStorage(row.ConfigurationId),
                new ConfigurationContentReference(
                    ContentLength.FromStorage(row.ContentLength),
                    ConfigurationDigest.FromStorage(row.ContentSha256)),
                UtcInstant.FromStorage(row.VersionCreatedAt)),
            new ConfigurationContentLease(row.ContentJson));
    }
}
