using CtlFlow.Configuration.Configd.Db.Custody;
using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Domain.Auditing;
using CtlFlow.Configuration.Configd.Domain.Secrets;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Configuration.Configd.Db.Custody.SecretCustody;
using static CtlFlow.Configuration.Configd.Domain.Secrets.Secrets;

namespace CtlFlow.Configuration.Configd.Db.Secrets;

public static partial class Secrets
{
    public static async Task<SecretMutationResult> PublishSecret(
        ConfigurationDatabase configurationDatabase,
        SecretDraft draft,
        SecretMaterialLease material,
        EncryptionKeyRing keyRing,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = ConfigurationDbTelemetry.StartOperation(
            "publish_secret");
        await using var mutation =
            await configurationDatabase.AcquireMutation(cancellation);
        var metadata = await QuerySecretMetadata(
            configurationDatabase,
            draft.Id,
            cancellation);
        var replay = await QuerySecretReplay(
            configurationDatabase,
            draft.VersionId,
            material,
            keyRing,
            cancellation);

        await using var database =
            await configurationDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        Secret? existing = null;
        if (metadata is not null)
        {
            existing = await RestoreSecret(metadata, cancellation);
            database.Attach(existing);
        }

        var decision = await Domain.Secrets.Secrets.PublishSecret(
            draft,
            existing,
            replay,
            audit,
            cancellation);
        if (decision is not SecretMutationResult.Changed changed)
        {
            return decision;
        }

        if (metadata is null)
        {
            database.Secrets.Add(changed.Entity);
        }

        database.Set<SecretVersionEnvelopeRow>().Add(
            EncryptSecretVersion(changed, draft, material, keyRing));
        try
        {
            await database.SaveChangesAsync(cancellation);
            return decision;
        }
        catch (DbUpdateConcurrencyException)
        {
            return new SecretMutationResult.RevisionMismatch();
        }
    }
}
