namespace CtlFlow.Packages.Pkgd.Domain.Apps;

public static partial class Apps
{
    public static AppDetails Describe(App app) =>
        new(
            app.AppId,
            app.Scope,
            app.PlacementId,
            app.PackageId,
            app.InitialPackageGeneration,
            app.DesiredPackageGeneration,
            app.Revision,
            app.CreatedAt,
            app.UpdatedAt);
}
