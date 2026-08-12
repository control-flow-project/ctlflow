namespace CtlFlow.Identity.Identityd.Domain.Groups;

public sealed record GroupMembershipChange(
    GroupMember Member,
    AccountGroupMembership? AccountMembership,
    VirtualPrincipalGroupMembership? VirtualMembership);
