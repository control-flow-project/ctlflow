using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Db.Custody;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Secrets;
using CtlFlow.Configuration.Configd.Domain.Time;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Configuration.Configd.Db.Secrets;

public static partial class Secrets
{
    public static async Task<(SecretMetadata Secret,
        SecretVersionMetadata Version)?> GetSecretMetadata(
        ConfigurationDatabase configurationDatabase,
        SecretId secretId,
        ConsumerBinding binding,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = ConfigurationDbTelemetry.StartOperation(
            "get_secret_metadata");
        var metadata = await QuerySecretMetadata(
            configurationDatabase,
            secretId,
            cancellation);
        if (metadata is null || metadata.Binding != binding)
        {
            return null;
        }

        await using var database =
            await configurationDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        var versionId = metadata.CurrentVersionId.Value;
        var queryCancellation = cancellation;
        var version = await database.Set<SecretVersionEnvelopeRow>()
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(
                    value,
                    "SecretVersionId") == versionId)
            .Select(value => new
            {
                SecretVersionId = EF.Property<string>(
                    value,
                    "SecretVersionId"),
                SecretId = EF.Property<string>(value, "SecretId"),
                CreatedAtUnixMilliseconds = EF.Property<long>(
                    value,
                    "CreatedAtUnixMilliseconds")
            })
            .SingleOrDefaultAsync(queryCancellation);
        if (version is null)
        {
            throw new InvalidOperationException(
                "Stored secret current version is absent");
        }

        return (
            metadata,
            new SecretVersionMetadata(
                SecretVersionId.FromStorage(version.SecretVersionId),
                SecretId.FromStorage(version.SecretId),
                UtcInstant.FromStorage(version.CreatedAtUnixMilliseconds)));
    }
}
