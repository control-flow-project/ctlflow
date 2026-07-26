using CtlFlow.Tenancy.Tenantd.Domain.Auditing;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public abstract record WorkspaceMutationResult
{
    private WorkspaceMutationResult()
    {
    }

    public sealed record Changed(
        Workspace Workspace,
        AuditIntent Audit) : WorkspaceMutationResult;

    public sealed record Current(
        WorkspaceDetails Workspace) : WorkspaceMutationResult;

    public sealed record NotFound : WorkspaceMutationResult;

    public sealed record AlreadyExists : WorkspaceMutationResult;

    public sealed record FailedPrecondition : WorkspaceMutationResult;

    public sealed record RevisionMismatch : WorkspaceMutationResult;
}
