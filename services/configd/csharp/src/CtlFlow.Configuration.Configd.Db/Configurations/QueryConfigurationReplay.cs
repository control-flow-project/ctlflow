using CtlFlow.Configuration.Configd.Db.Content;
using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Claims;
using CtlFlow.Configuration.Configd.Domain.Configurations;
using CtlFlow.Configuration.Configd.Domain.Content;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;
using CtlFlow.Configuration.Configd.Domain.Time;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Configuration.Configd.Db.Configurations;

public static partial class Configurations
{
    internal static async Task<ConfigurationReplay?>
        QueryConfigurationReplay(
            ConfigurationDatabase configurationDatabase,
            ConfigurationVersionId versionId,
            ConfigurationContentLease content,
            CancellationToken cancellation)
    {
        await using var database =
            await configurationDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        var id = versionId.Value;
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
                    "ConfigurationVersionId") == id)
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
                RequestExpectedRevision = EF.Property<long?>(
                    value.Version,
                    "RequestExpectedRevision"),
                DependencyClaimId = EF.Property<string?>(
                    value.Version,
                    "DependencyClaimId"),
                DependencyClaimRevision = EF.Property<long?>(
                    value.Version,
                    "DependencyClaimRevision"),
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
        if (row is null)
        {
            return null;
        }

        var binding = BindingStorage.FromStorage(
            row.ScopeKind,
            row.PlacementId,
            row.TenantId,
            row.WorkspaceId,
            row.AccountPrincipalId,
            row.ConsumerId,
            row.Purpose);
        var configurationId =
            ConfigurationId.FromStorage(row.ConfigurationId);
        return new ConfigurationReplay(
            new ConfigurationMetadata(
                configurationId,
                binding,
                ConfigurationVersionId.FromStorage(row.CurrentVersionId),
                Revision.FromStorage(row.Revision),
                row.CreatedAt,
                row.UpdatedAt),
            new ConfigurationVersionMetadata(
                ConfigurationVersionId.FromStorage(
                    row.ConfigurationVersionId),
                configurationId,
                new ConfigurationContentReference(
                    ContentLength.FromStorage(row.ContentLength),
                    ConfigurationDigest.FromStorage(row.ContentSha256)),
                UtcInstant.FromStorage(row.VersionCreatedAt)),
            row.RequestExpectedRevision is null
                ? null
                : Revision.FromStorage(row.RequestExpectedRevision.Value),
            CreateClaim(
                row.DependencyClaimId,
                row.DependencyClaimRevision),
            content.Matches(row.ContentJson));
    }

    private static DependencyClaimSelector? CreateClaim(
        string? id,
        long? revision) =>
        id is null && revision is null
            ? null
            : id is not null && revision is not null
                ? new DependencyClaimSelector(
                    DependencyClaimId.FromStorage(id),
                    Revision.FromStorage(revision.Value))
                : throw new InvalidOperationException(
                    "Stored dependency claim selector is invalid");
}
