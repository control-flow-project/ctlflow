namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record PackageDependencySpec(
    DependencyName Name,
    DependencyId? DependencyId,
    ComponentId ComponentId,
    DependencyType DependencyType,
    DependencyOptionsReference Options);
