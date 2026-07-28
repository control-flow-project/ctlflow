using CtlFlow.Packages.Pkgd.Db.Content;
using CtlFlow.Packages.Pkgd.Domain.Packages;

namespace CtlFlow.Packages.Pkgd.Db.Packages;

public abstract record PackageContentLookupResult
{
    private PackageContentLookupResult()
    {
    }

    public sealed record Found(
        PackageDetails Package,
        IReadOnlyList<DependencyOptionsContent> Options)
        : PackageContentLookupResult;

    public sealed record NotFound : PackageContentLookupResult;
}
