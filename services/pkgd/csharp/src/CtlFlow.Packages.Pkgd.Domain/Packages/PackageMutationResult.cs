using CtlFlow.Packages.Pkgd.Domain.Auditing;

namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public abstract record PackageMutationResult
{
    private PackageMutationResult()
    {
    }

    public sealed record Changed(
        PackageWriteSet Package,
        PackageDetails Details,
        AuditIntent Audit) : PackageMutationResult;

    public sealed record Current(
        PackageDetails Package) : PackageMutationResult;

    public sealed record AlreadyExists : PackageMutationResult;
    public sealed record FailedPrecondition : PackageMutationResult;
}
