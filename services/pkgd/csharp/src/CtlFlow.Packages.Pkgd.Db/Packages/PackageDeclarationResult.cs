using CtlFlow.Packages.Pkgd.Db.Content;
using CtlFlow.Packages.Pkgd.Domain.Packages;

namespace CtlFlow.Packages.Pkgd.Db.Packages;

public sealed record PackageDeclarationResult(
    PackageMutationResult Mutation,
    IReadOnlyList<DependencyOptionsContent> Options);
