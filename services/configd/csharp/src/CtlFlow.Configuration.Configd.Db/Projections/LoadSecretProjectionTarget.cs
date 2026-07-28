using CtlFlow.Configuration.Configd.Db.Custody;
using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Projections;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Configuration.Configd.Db.Custody.SecretCustody;

namespace CtlFlow.Configuration.Configd.Db.Projections;

public static partial class Projections
{
    internal static async Task<ProjectionTargetLookup>
        LoadSecretProjectionTarget(
            ConfigurationDatabase configurationDatabase,
            ProjectionTarget.Secret target,
            ConsumerBinding binding,
            EncryptionKeyRing keyRing,
            CancellationToken cancellation)
    {
        await using var database =
            await configurationDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        var secretId = target.SecretId.Value;
        var versionId = target.VersionId.Value;
        var queryCancellation = cancellation;
        var row = await database.Set<SecretVersionEnvelopeRow>()
            .AsNoTracking()
            .Join(
                database.Secrets.AsNoTracking(),
                version => EF.Property<string>(version, "SecretId"),
                secret => EF.Property<string>(secret, "_secretId"),
                (version, secret) => new
                {
                    Version = version,
                    Secret = secret
                })
            .Where(value =>
                EF.Property<string>(
                    value.Version,
                    "SecretId") == secretId
                && EF.Property<string>(
                    value.Version,
                    "SecretVersionId") == versionId)
            .Select(value => new
            {
                SecretVersionId = EF.Property<string>(
                    value.Version,
                    "SecretVersionId"),
                SecretId = EF.Property<string>(
                    value.Version,
                    "SecretId"),
                Ciphertext = EF.Property<byte[]>(
                    value.Version,
                    "Ciphertext"),
                MaterialLength = EF.Property<int>(
                    value.Version,
                    "MaterialLength"),
                Nonce = EF.Property<byte[]>(
                    value.Version,
                    "Nonce"),
                AuthenticationTag = EF.Property<byte[]>(
                    value.Version,
                    "AuthenticationTag"),
                EncryptionKeyId = EF.Property<string>(
                    value.Version,
                    "EncryptionKeyId"),
                RequestExpectedRevision = EF.Property<long?>(
                    value.Version,
                    "RequestExpectedRevision"),
                DependencyClaimId = EF.Property<string?>(
                    value.Version,
                    "DependencyClaimId"),
                DependencyClaimRevision = EF.Property<long?>(
                    value.Version,
                    "DependencyClaimRevision"),
                AuditEventId = EF.Property<string>(
                    value.Version,
                    "AuditEventId"),
                VersionCreatedAt = EF.Property<long>(
                    value.Version,
                    "CreatedAtUnixMilliseconds"),
                CurrentVersionId = EF.Property<string>(
                    value.Secret,
                    "_currentSecretVersionId"),
                ScopeKind = EF.Property<int>(
                    value.Secret,
                    "_scopeKind"),
                PlacementId = EF.Property<string>(
                    value.Secret,
                    "_placementId"),
                TenantId = EF.Property<string?>(
                    value.Secret,
                    "_tenantId"),
                WorkspaceId = EF.Property<string?>(
                    value.Secret,
                    "_workspaceId"),
                AccountPrincipalId = EF.Property<string?>(
                    value.Secret,
                    "_accountPrincipalId"),
                ConsumerId = EF.Property<string>(
                    value.Secret,
                    "_consumerId"),
                Purpose = EF.Property<string>(
                    value.Secret,
                    "_purpose")
            })
            .SingleOrDefaultAsync(queryCancellation);
        if (row is null)
        {
            return new ProjectionTargetLookup(false, false, null);
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
            return new ProjectionTargetLookup(false, false, null);
        }

        var isCurrent = string.Equals(
            row.CurrentVersionId,
            versionId,
            StringComparison.Ordinal);
        var envelope = RestoreSecretVersionEnvelope(
            row.SecretVersionId,
            row.SecretId,
            row.Ciphertext,
            row.MaterialLength,
            row.Nonce,
            row.AuthenticationTag,
            row.EncryptionKeyId,
            row.RequestExpectedRevision,
            row.DependencyClaimId,
            row.DependencyClaimRevision,
            row.AuditEventId,
            row.VersionCreatedAt);
        return isCurrent
            ? new ProjectionTargetLookup(
                true,
                true,
                new ProjectionPayloadLease.Secret(
                    DecryptSecretVersion(envelope, binding, keyRing)))
            : new ProjectionTargetLookup(true, false, null);
    }
}
