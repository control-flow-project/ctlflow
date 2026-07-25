using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public sealed record UpdateWorkspaceCommand(
    WorkspaceId WorkspaceId,
    WorkspaceDisplayName DisplayName,
    ResourceEventSequence ExpectedResourceVersion,
    RequestActor Actor,
    IdempotencyKey IdempotencyKey,
    RequestDigest RequestDigest);
