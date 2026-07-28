using CtlFlow.Packages.Pkgd.Domain.Packages;
using CtlFlow.Packages.Pkgd.Domain.Time;

namespace CtlFlow.Packages.Pkgd.Domain.Apps;

public sealed record AppDetails(
    AppId AppId,
    AppScope Scope,
    PlacementId PlacementId,
    PackageId PackageId,
    Generation InitialPackageGeneration,
    Generation DesiredPackageGeneration,
    Revision Revision,
    UtcInstant CreatedAt,
    UtcInstant UpdatedAt);
