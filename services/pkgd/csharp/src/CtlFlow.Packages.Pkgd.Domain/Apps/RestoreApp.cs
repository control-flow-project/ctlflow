using CtlFlow.Packages.Pkgd.Domain.Packages;
using CtlFlow.Packages.Pkgd.Domain.Time;

namespace CtlFlow.Packages.Pkgd.Domain.Apps;

public static partial class Apps
{
    public static ValueTask<App> RestoreApp(
        AppId appId,
        AppScope scope,
        PlacementId placementId,
        PackageId packageId,
        Generation initialPackageGeneration,
        Generation desiredPackageGeneration,
        Revision revision,
        UtcInstant createdAt,
        UtcInstant updatedAt,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (updatedAt.Value < createdAt.Value)
        {
            throw new InvalidOperationException(
                "Stored App timestamps are inconsistent");
        }

        return ValueTask.FromResult(new App(
            appId,
            scope,
            placementId,
            packageId,
            initialPackageGeneration,
            desiredPackageGeneration,
            revision,
            createdAt,
            updatedAt));
    }
}
