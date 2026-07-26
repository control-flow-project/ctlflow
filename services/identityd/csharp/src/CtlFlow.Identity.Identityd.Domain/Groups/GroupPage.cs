namespace CtlFlow.Identity.Identityd.Domain.Groups;

public sealed record GroupPage(
    IReadOnlyList<GroupId> GroupIds,
    GroupId? NextAfterGroupId);
