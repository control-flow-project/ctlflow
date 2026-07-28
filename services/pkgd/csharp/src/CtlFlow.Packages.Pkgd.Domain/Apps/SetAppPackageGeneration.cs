using CtlFlow.Packages.Pkgd.Domain.Auditing;
using CtlFlow.Packages.Pkgd.Domain.Packages;

namespace CtlFlow.Packages.Pkgd.Domain.Apps;

public static partial class Apps
{
    public static ValueTask<AppMutationResult> SetAppPackageGeneration(
        App app,
        Revision expectedRevision,
        Generation desiredPackageGeneration,
        bool packageGenerationExists,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var currentRevision = app.Revision;
        var currentGeneration = app.DesiredPackageGeneration;

        if (currentRevision == expectedRevision)
        {
            if (currentGeneration == desiredPackageGeneration)
            {
                return ValueTask.FromResult<AppMutationResult>(
                    new AppMutationResult.Current(Describe(app)));
            }

            if (!packageGenerationExists)
            {
                return ValueTask.FromResult<AppMutationResult>(
                    new AppMutationResult.NotFound());
            }

            if (currentRevision.Value == long.MaxValue)
            {
                return ValueTask.FromResult<AppMutationResult>(
                    new AppMutationResult.FailedPrecondition());
            }

            app.SetDesiredPackageGeneration(
                desiredPackageGeneration,
                audit.OccurredAt);
            var changed = Describe(app);
            return ValueTask.FromResult<AppMutationResult>(
                new AppMutationResult.Changed(
                    app,
                    changed,
                    CreateGenerationAudit(changed, audit)));
        }

        if (expectedRevision.Value < long.MaxValue
            && currentRevision.Value == expectedRevision.Value + 1
            && currentGeneration == desiredPackageGeneration)
        {
            return ValueTask.FromResult<AppMutationResult>(
                new AppMutationResult.Current(Describe(app)));
        }

        return ValueTask.FromResult<AppMutationResult>(
            new AppMutationResult.RevisionMismatch());
    }

    private static AuditIntent CreateGenerationAudit(
        AppDetails app,
        AuditContext context) =>
        new AuditIntent.AppMutation(
            AuditEventId.ForApp(app.AppId, app.Revision),
            context.Attribution,
            context.Correlation,
            app.UpdatedAt,
            app.AppId,
            app.Scope,
            app.PlacementId,
            app.PackageId,
            app.DesiredPackageGeneration,
            app.Revision,
            AppAuditAction.PackageGenerationChanged);
}
