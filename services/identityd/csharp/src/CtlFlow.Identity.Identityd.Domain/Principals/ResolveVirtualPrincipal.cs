using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;

namespace CtlFlow.Identity.Identityd.Domain.Principals;

public static partial class Principals
{
    public static ValueTask<PrincipalLookupResult> ResolveVirtualPrincipal(
        VirtualPrincipalId principalId,
        bool principalEnabled,
        Revision principalRevision,
        AccountId subjectAccountId,
        AccountKind storedAccountKind,
        bool subjectAccountEnabled,
        Revision subjectAccountRevision,
        TenantId tenantFenceId,
        WorkspaceId? workspaceFenceId,
        IdentityTarget target,
        Revision? membershipRevision,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (subjectAccountId.Kind != storedAccountKind)
        {
            throw new InvalidOperationException(
                "Stored account kind does not match its principal ID");
        }

        var insideFence = tenantFenceId == target.TenantId
            && (
                target.WorkspaceId is null
                || workspaceFenceId is null
                || workspaceFenceId == target.WorkspaceId);
        return ValueTask.FromResult<PrincipalLookupResult>(
            !insideFence || membershipRevision is null
                ? new PrincipalLookupResult.NotFound()
                : new PrincipalLookupResult.Found(
                    new PrincipalFacts(
                        principalId.Principal,
                        PrincipalKind.Virtual,
                        principalEnabled,
                        principalRevision,
                        subjectAccountId,
                        subjectAccountEnabled,
                        subjectAccountRevision,
                        membershipRevision)));
    }
}
