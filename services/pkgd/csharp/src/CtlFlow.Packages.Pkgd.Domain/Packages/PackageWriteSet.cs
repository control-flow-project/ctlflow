namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record PackageWriteSet(
    PackageDeclaration Declaration,
    IReadOnlyList<PackageComponent> Components,
    IReadOnlyList<PackageComponentOperation> ComponentOperations,
    IReadOnlyList<PackageInterface> Interfaces,
    IReadOnlyList<PackageDependency> Dependencies,
    IReadOnlyList<PackageExposure> Exposures);
