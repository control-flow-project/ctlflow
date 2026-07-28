using CtlFlow.Configuration.Configd.Db.Providers;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Configuration.Configd.Db.Custody;

public static partial class SecretCustody
{
    public static async Task<bool> VerifyEncryptionKeyCoverage(
        ConfigurationDatabase configurationDatabase,
        EncryptionKeyRing keyRing,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = ConfigurationDbTelemetry.StartOperation(
            "verify_encryption_key_coverage");
        await using var database =
            await configurationDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        var queryCancellation = cancellation;
        var keyIds = await database.Set<SecretVersionEnvelopeRow>()
            .AsNoTracking()
            .Select(value => EF.Property<string>(
                value,
                "EncryptionKeyId"))
            .Distinct()
            .OrderBy(value => value)
            .ToListAsync(queryCancellation);
        return keyIds.All(value =>
            keyRing.Contains(EncryptionKeyId.FromStorage(value)));
    }
}
