using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;

namespace CtlFlow.Identity.Identityd.Domain.Groups;

public static partial class Groups
{
    public static ValueTask<IdentityMutation<GroupMembershipChange>>
        AddGroupMember(
            Group? group,
            PrincipalFacts? principal,
            bool membershipExists,
            GroupId groupId,
            PrincipalId principalId,
            IdentityTarget target,
            AuditContext audit,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (group is null
            || group.TenantId != target.TenantId
            || group.WorkspaceId != target.WorkspaceId)
        {
            throw new IdentityNotFoundException();
        }
        if (principal is null || principal.PrincipalId != principalId)
        {
            throw new IdentityNotFoundException();
        }

        var change = principal.PrincipalKind switch
        {
            PrincipalKind.Human or PrincipalKind.Service =>
                new GroupMembershipChange(
                    new GroupMember(
                        group!,
                        principalId,
                        principal.PrincipalKind),
                    membershipExists
                        ? null
                        : new AccountGroupMembership(
                            principal.SubjectAccountId,
                            groupId),
                    null),
            PrincipalKind.Virtual => new GroupMembershipChange(
                new GroupMember(
                    group!,
                    principalId,
                    PrincipalKind.Virtual),
                null,
                membershipExists
                    ? null
                    : new VirtualPrincipalGroupMembership(
                        VirtualPrincipalId.FromStorage(principalId.Value),
                        groupId)),
            _ => throw new InvalidOperationException(
                "Principal kind is not supported")
        };
        return ValueTask.FromResult(
            new IdentityMutation<GroupMembershipChange>(
                change,
                membershipExists
                    ? null
                    : new GroupMemberAuditIntent(
                        AuditEventId.Generate(),
                        audit.Attribution,
                        target.TenantId,
                        target.WorkspaceId,
                        groupId,
                        principalId,
                        GroupMemberAuditAction.Added,
                        audit.Correlation,
                        audit.OccurredAt)));
    }

}
