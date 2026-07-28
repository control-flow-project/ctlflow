namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record PackageDraft(
    PackageId PackageId,
    Generation Generation,
    SemanticVersion Version,
    PackageProvenance Provenance,
    IReadOnlyList<PackageComponentSpec> Components,
    IReadOnlyList<PackageInterfaceSpec> Interfaces,
    IReadOnlyList<PackageDependencySpec> Dependencies,
    IReadOnlyList<PackageExposureSpec> Exposures);
