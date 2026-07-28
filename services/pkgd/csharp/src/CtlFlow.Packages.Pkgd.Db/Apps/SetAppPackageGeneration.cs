using CtlFlow.Packages.Pkgd.Db.Providers;
using CtlFlow.Packages.Pkgd.Domain.Apps;
using CtlFlow.Packages.Pkgd.Domain.Auditing;
using CtlFlow.Packages.Pkgd.Domain.Packages;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Packages.Pkgd.Domain.Apps.Apps;

namespace CtlFlow.Packages.Pkgd.Db.Apps;

public static partial class Apps
{
    public static async Task<AppMutationResult> SetAppPackageGeneration(
        PackageDatabase packageDatabase,
        AppId appId,
        Revision expectedRevision,
        Generation desiredPackageGeneration,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = PackageDbTelemetry.StartOperation(
            "set_app_package_generation");
        await using var mutation =
            await packageDatabase.AcquireMutation(cancellation);
        var existing = await QueryApp(packageDatabase, appId, cancellation);
        if (existing is null)
        {
            return new AppMutationResult.NotFound();
        }

        await using var database =
            await packageDatabase.Contexts.CreateDbContextAsync(cancellation);
        var app = await RestoreApp(
            existing.AppId,
            existing.Scope,
            existing.PlacementId,
            existing.PackageId,
            existing.InitialPackageGeneration,
            existing.DesiredPackageGeneration,
            existing.Revision,
            existing.CreatedAt,
            existing.UpdatedAt,
            cancellation);
        database.Attach(app);
        var packageExists = await PackageGenerationExists(
            packageDatabase,
            existing.PackageId,
            desiredPackageGeneration,
            cancellation);
        var decision = await Domain.Apps.Apps.SetAppPackageGeneration(
            app,
            expectedRevision,
            desiredPackageGeneration,
            packageExists,
            audit,
            cancellation);
        if (decision is not AppMutationResult.Changed)
        {
            return decision;
        }

        try
        {
            await database.SaveChangesAsync(cancellation);
            return decision;
        }
        catch (DbUpdateConcurrencyException)
        {
            return new AppMutationResult.RevisionMismatch();
        }
    }
}
