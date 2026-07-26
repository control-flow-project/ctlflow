namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public sealed record WorkspacePage(
    IReadOnlyList<WorkspaceDetails> Workspaces,
    WorkspaceId? NextAfterWorkspaceId);
