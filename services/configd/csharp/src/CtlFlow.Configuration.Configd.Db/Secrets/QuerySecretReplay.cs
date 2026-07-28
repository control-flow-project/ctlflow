using CtlFlow.Configuration.Configd.Db.Custody;
using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Claims;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;
using CtlFlow.Configuration.Configd.Domain.Secrets;
using CtlFlow.Configuration.Configd.Domain.Time;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Configuration.Configd.Db.Custody.SecretCustody;

namespace CtlFlow.Configuration.Configd.Db.Secrets;

public static partial class Secrets
{
    internal static async Task<SecretReplay?> QuerySecretReplay(
        ConfigurationDatabase configurationDatabase,
        SecretVersionId versionId,
        SecretMaterialLease material,
        EncryptionKeyRing keyRing,
        CancellationToken cancellation)
    {
        await using var database =
            await configurationDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        var id = versionId.Value;
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
                    "SecretVersionId") == id)
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
                    "_purpose"),
                CurrentVersionId = EF.Property<string>(
                    value.Secret,
                    "_currentSecretVersionId"),
                Revision = EF.Property<long>(
                    value.Secret,
                    "_revision"),
                value.Secret.CreatedAt,
                value.Secret.UpdatedAt
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
        using var existingMaterial = DecryptSecretVersion(
            envelope,
            binding,
            keyRing);
        var secretId = SecretId.FromStorage(row.SecretId);
        return new SecretReplay(
            new SecretMetadata(
                secretId,
                binding,
                SecretVersionId.FromStorage(row.CurrentVersionId),
                Revision.FromStorage(row.Revision),
                row.CreatedAt,
                row.UpdatedAt),
            new SecretVersionMetadata(
                SecretVersionId.FromStorage(row.SecretVersionId),
                secretId,
                UtcInstant.FromStorage(row.VersionCreatedAt)),
            row.RequestExpectedRevision is null
                ? null
                : Revision.FromStorage(
                    row.RequestExpectedRevision.Value),
            CreateClaim(
                row.DependencyClaimId,
                row.DependencyClaimRevision),
            existingMaterial.FixedTimeEquals(material.Span));
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
