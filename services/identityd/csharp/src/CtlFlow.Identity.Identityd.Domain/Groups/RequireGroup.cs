using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.Targets;

namespace CtlFlow.Identity.Identityd.Domain.Groups;

public static partial class Groups
{
    public static ValueTask<Group> RequireGroup(
        Group? group,
        IdentityTarget target,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (group is null
            || group.TenantId != target.TenantId
            || group.WorkspaceId != target.WorkspaceId)
        {
            throw new IdentityNotFoundException();
        }

        return ValueTask.FromResult(group);
    }
}
