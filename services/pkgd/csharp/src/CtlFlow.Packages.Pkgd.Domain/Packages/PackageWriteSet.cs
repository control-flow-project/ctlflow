namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record PackageWriteSet(
    PackageDeclaration Declaration,
    IReadOnlyList<PackageComponent> Components,
    IReadOnlyList<PackageInterface> Interfaces,
    IReadOnlyList<PackageDependency> Dependencies,
    IReadOnlyList<PackageExposure> Exposures);
