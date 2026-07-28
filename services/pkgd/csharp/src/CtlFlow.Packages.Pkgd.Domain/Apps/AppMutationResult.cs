using CtlFlow.Packages.Pkgd.Domain.Auditing;

namespace CtlFlow.Packages.Pkgd.Domain.Apps;

public abstract record AppMutationResult
{
    private AppMutationResult()
    {
    }

    public sealed record Changed(
        App Entity,
        AppDetails App,
        AuditIntent Audit) : AppMutationResult;

    public sealed record Current(AppDetails App) : AppMutationResult;

    public sealed record NotFound : AppMutationResult;

    public sealed record AlreadyExists : AppMutationResult;

    public sealed record RevisionMismatch : AppMutationResult;

    public sealed record FailedPrecondition : AppMutationResult;
}
