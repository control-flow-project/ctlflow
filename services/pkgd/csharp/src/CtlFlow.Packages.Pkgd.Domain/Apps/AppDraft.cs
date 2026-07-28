using CtlFlow.Packages.Pkgd.Domain.Packages;

namespace CtlFlow.Packages.Pkgd.Domain.Apps;

public sealed record AppDraft(
    AppId AppId,
    AppScope Scope,
    PlacementId PlacementId,
    PackageId PackageId,
    Generation DesiredPackageGeneration);
