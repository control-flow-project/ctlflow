using CtlFlow.Packages.Pkgd.Domain.Auditing;
using CtlFlow.Packages.Pkgd.Domain.Packages;

namespace CtlFlow.Packages.Pkgd.Domain.Apps;

public static partial class Apps
{
    public static ValueTask<AppMutationResult> CreateApp(
        AppDraft draft,
        AppDetails? existing,
        bool packageGenerationExists,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (existing is not null)
        {
            var identical = draft.AppId == existing.AppId
                && draft.Scope == existing.Scope
                && draft.PlacementId == existing.PlacementId
                && draft.PackageId == existing.PackageId
                && draft.DesiredPackageGeneration
                    == existing.InitialPackageGeneration;
            return ValueTask.FromResult<AppMutationResult>(
                identical
                    ? new AppMutationResult.Current(existing)
                    : new AppMutationResult.AlreadyExists());
        }

        if (!packageGenerationExists)
        {
            return ValueTask.FromResult<AppMutationResult>(
                new AppMutationResult.NotFound());
        }

        var revision = Revision.Initial();
        var entity = new App(
            draft.AppId,
            draft.Scope,
            draft.PlacementId,
            draft.PackageId,
            draft.DesiredPackageGeneration,
            draft.DesiredPackageGeneration,
            revision,
            audit.OccurredAt,
            audit.OccurredAt);
        var details = Describe(entity);
        return ValueTask.FromResult<AppMutationResult>(
            new AppMutationResult.Changed(
                entity,
                details,
                CreateCreationAudit(details, audit)));
    }

    private static AuditIntent CreateCreationAudit(
        AppDetails app,
        AuditContext context) =>
        new AuditIntent.AppMutation(
            AuditEventId.ForApp(app.AppId, Revision.Initial()),
            context.Attribution,
            context.Correlation,
            app.CreatedAt,
            app.AppId,
            app.Scope,
            app.PlacementId,
            app.PackageId,
            app.InitialPackageGeneration,
            Revision.Initial(),
            AppAuditAction.Created);
}
