using CtlFlow.Configuration.Configd.Domain.Auditing;
using CtlFlow.Configuration.Configd.Domain.Projections;
using CtlFlow.Configuration.Configd.Domain.Revisions;

namespace CtlFlow.Configuration.Configd.Domain.Configurations;

public static partial class Configurations
{
    public static async ValueTask<ConfigurationMutationResult>
        PublishConfiguration(
            ConfigurationDraft draft,
            ConfigurationResource? existing,
            ConfigurationReplay? replay,
            AuditContext audit,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (replay is not null)
        {
            return IsExactReplay(draft, replay)
                ? new ConfigurationMutationResult.Current(
                    replay.Configuration,
                    replay.Version)
                : new ConfigurationMutationResult.AlreadyExists();
        }

        if (draft.ExpectedRevision is null)
        {
            if (existing is not null)
            {
                return new ConfigurationMutationResult.AlreadyExists();
            }

            var revision = Revision.Initial();
            var entity = new ConfigurationResource(
                draft.Id,
                draft.Binding,
                draft.VersionId,
                revision,
                audit.OccurredAt,
                audit.OccurredAt);
            return await CreateChangedResult(
                entity,
                draft,
                revision,
                audit,
                cancellation);
        }

        if (existing is null || existing.Binding != draft.Binding)
        {
            return new ConfigurationMutationResult.NotFound();
        }

        if (existing.Revision != draft.ExpectedRevision)
        {
            return new ConfigurationMutationResult.RevisionMismatch();
        }

        if (existing.Revision.Value == long.MaxValue)
        {
            return new ConfigurationMutationResult.FailedPrecondition();
        }

        existing.SelectVersion(draft.VersionId, audit.OccurredAt);
        return await CreateChangedResult(
            existing,
            draft,
            existing.Revision,
            audit,
            cancellation);
    }

    private static bool IsExactReplay(
        ConfigurationDraft draft,
        ConfigurationReplay replay) =>
        replay.ExactContentMatches
        && replay.Configuration.Id == draft.Id
        && replay.Configuration.Binding == draft.Binding
        && replay.Version.Id == draft.VersionId
        && replay.Version.ConfigurationId == draft.Id
        && replay.Version.Content == draft.Content
        && replay.RequestExpectedRevision == draft.ExpectedRevision
        && replay.DependencyClaim == draft.DependencyClaim;

    private static async ValueTask<ConfigurationMutationResult>
        CreateChangedResult(
            ConfigurationResource entity,
            ConfigurationDraft draft,
            Revision revision,
            AuditContext audit,
            CancellationToken cancellation)
    {
        var configuration = await DescribeConfiguration(entity, cancellation);
        var version = new ConfigurationVersionMetadata(
            draft.VersionId,
            draft.Id,
            draft.Content,
            audit.OccurredAt);
        var intent = new PublicationAuditIntent(
            AuditEnvelope.Create(audit),
            new ProjectionTarget.Configuration(draft.Id, draft.VersionId),
            draft.Binding,
            revision,
            draft.DependencyClaim);
        return new ConfigurationMutationResult.Changed(
            entity,
            configuration,
            version,
            intent);
    }
}
