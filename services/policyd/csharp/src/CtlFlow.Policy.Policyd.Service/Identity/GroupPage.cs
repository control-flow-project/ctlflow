using CtlFlow.Policy.Policyd.Domain.Identifiers;

namespace CtlFlow.Policy.Policyd.Service.Identity;

internal sealed record GroupPage(
    IReadOnlyList<GroupId> Groups,
    GroupId? NextAfterGroupId);
