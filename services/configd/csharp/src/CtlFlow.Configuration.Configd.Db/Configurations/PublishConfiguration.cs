using CtlFlow.Configuration.Configd.Db.Content;
using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Domain.Auditing;
using CtlFlow.Configuration.Configd.Domain.Configurations;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Configuration.Configd.Domain.Configurations.Configurations;
using ConfigurationEntity =
    CtlFlow.Configuration.Configd.Domain.Configurations.ConfigurationResource;

namespace CtlFlow.Configuration.Configd.Db.Configurations;

public static partial class Configurations
{
    public static async Task<ConfigurationMutationResult>
        PublishConfiguration(
            ConfigurationDatabase configurationDatabase,
            ConfigurationDraft draft,
            ConfigurationContentLease content,
            AuditContext audit,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = ConfigurationDbTelemetry.StartOperation(
            "publish_configuration");
        await using var mutation =
            await configurationDatabase.AcquireMutation(cancellation);
        var metadata = await QueryConfigurationMetadata(
            configurationDatabase,
            draft.Id,
            cancellation);
        var replay = await QueryConfigurationReplay(
            configurationDatabase,
            draft.VersionId,
            content,
            cancellation);

        await using var database =
            await configurationDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        ConfigurationEntity? existing = null;
        if (metadata is not null)
        {
            existing = await RestoreConfiguration(metadata, cancellation);
            database.Attach(existing);
        }

        var decision = await Domain.Configurations.Configurations
            .PublishConfiguration(
                draft,
                existing,
                replay,
                audit,
                cancellation);
        if (decision is not ConfigurationMutationResult.Changed changed)
        {
            return decision;
        }

        if (metadata is null)
        {
            database.Configurations.Add(changed.Entity);
        }

        var digest = new byte[32];
        draft.Content.Digest.CopyTo(digest);
        database.Set<ConfigurationVersionContentRow>().Add(
            new ConfigurationVersionContentRow(
                draft.VersionId.Value,
                draft.Id.Value,
                content.Copy(),
                draft.Content.Length.Value,
                digest,
                draft.ExpectedRevision?.Value,
                draft.DependencyClaim?.Id.Value,
                draft.DependencyClaim?.Revision.Value,
                changed.Audit.Envelope.EventId.Value,
                changed.Version.CreatedAt.UnixMilliseconds));
        try
        {
            await database.SaveChangesAsync(cancellation);
            return decision;
        }
        catch (DbUpdateConcurrencyException)
        {
            return new ConfigurationMutationResult.RevisionMismatch();
        }
    }
}
