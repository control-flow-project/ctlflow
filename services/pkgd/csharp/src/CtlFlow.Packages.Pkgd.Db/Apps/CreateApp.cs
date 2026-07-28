using CtlFlow.Packages.Pkgd.Db.Providers;
using CtlFlow.Packages.Pkgd.Domain.Apps;
using CtlFlow.Packages.Pkgd.Domain.Auditing;

namespace CtlFlow.Packages.Pkgd.Db.Apps;

public static partial class Apps
{
    public static async Task<AppMutationResult> CreateApp(
        PackageDatabase packageDatabase,
        AppDraft draft,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = PackageDbTelemetry.StartOperation("create_app");
        await using var mutation =
            await packageDatabase.AcquireMutation(cancellation);
        var existing = await QueryApp(
            packageDatabase,
            draft.AppId,
            cancellation);
        var packageExists = await PackageGenerationExists(
            packageDatabase,
            draft.PackageId,
            draft.DesiredPackageGeneration,
            cancellation);
        var decision = await Domain.Apps.Apps.CreateApp(
            draft,
            existing,
            packageExists,
            audit,
            cancellation);
        if (decision is AppMutationResult.Changed changed)
        {
            await using var database =
                await packageDatabase.Contexts.CreateDbContextAsync(
                    cancellation);
            database.Apps.Add(changed.Entity);
            await database.SaveChangesAsync(cancellation);
        }

        return decision;
    }
}
