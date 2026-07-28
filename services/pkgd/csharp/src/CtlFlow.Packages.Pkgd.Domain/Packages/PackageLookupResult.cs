namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public abstract record PackageLookupResult
{
    private PackageLookupResult()
    {
    }

    public sealed record Found(PackageDetails Package) : PackageLookupResult;
    public sealed record NotFound : PackageLookupResult;
}
