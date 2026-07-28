using CtlFlow.Configuration.Configd.Domain.Auditing;
using CtlFlow.Configuration.Configd.Domain.Projections;
using CtlFlow.Configuration.Configd.Domain.Revisions;

namespace CtlFlow.Configuration.Configd.Domain.Secrets;

public static partial class Secrets
{
    public static async ValueTask<SecretMutationResult> PublishSecret(
        SecretDraft draft,
        Secret? existing,
        SecretReplay? replay,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (replay is not null)
        {
            return IsExactReplay(draft, replay)
                ? new SecretMutationResult.Current(
                    replay.Secret,
                    replay.Version)
                : new SecretMutationResult.AlreadyExists();
        }

        if (draft.ExpectedRevision is null)
        {
            if (existing is not null)
            {
                return new SecretMutationResult.AlreadyExists();
            }

            var revision = Revision.Initial();
            var entity = new Secret(
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
            return new SecretMutationResult.NotFound();
        }

        if (existing.Revision != draft.ExpectedRevision)
        {
            return new SecretMutationResult.RevisionMismatch();
        }

        if (existing.Revision.Value == long.MaxValue)
        {
            return new SecretMutationResult.FailedPrecondition();
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
        SecretDraft draft,
        SecretReplay replay) =>
        replay.ExactMaterialMatches
        && replay.Secret.Id == draft.Id
        && replay.Secret.Binding == draft.Binding
        && replay.Version.Id == draft.VersionId
        && replay.Version.SecretId == draft.Id
        && replay.RequestExpectedRevision == draft.ExpectedRevision
        && replay.DependencyClaim == draft.DependencyClaim;

    private static async ValueTask<SecretMutationResult> CreateChangedResult(
        Secret entity,
        SecretDraft draft,
        Revision revision,
        AuditContext audit,
        CancellationToken cancellation)
    {
        var secret = await DescribeSecret(entity, cancellation);
        var version = new SecretVersionMetadata(
            draft.VersionId,
            draft.Id,
            audit.OccurredAt);
        var intent = new PublicationAuditIntent(
            AuditEnvelope.Create(audit),
            new ProjectionTarget.Secret(draft.Id, draft.VersionId),
            draft.Binding,
            revision,
            draft.DependencyClaim);
        return new SecretMutationResult.Changed(
            entity,
            secret,
            version,
            intent);
    }
}
