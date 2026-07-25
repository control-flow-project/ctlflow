namespace CtlFlow.Tenancy.Tenantd.Domain.Provisioning;

public sealed record InitialWorkspaceMembershipIntent(
    UserId UserId,
    MembershipStanding Standing);
