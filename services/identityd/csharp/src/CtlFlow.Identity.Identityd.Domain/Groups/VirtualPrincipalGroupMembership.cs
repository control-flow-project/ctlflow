using CtlFlow.Identity.Identityd.Domain.Principals;

namespace CtlFlow.Identity.Identityd.Domain.Groups;

public class VirtualPrincipalGroupMembership
{
    private string _principalId = null!;
    private string _groupId = null!;

    private VirtualPrincipalGroupMembership()
    {
    }

    public VirtualPrincipalGroupMembership(
        VirtualPrincipalId principalId,
        GroupId groupId)
    {
        _principalId = principalId.Value;
        _groupId = groupId.Value;
    }

    public VirtualPrincipalId PrincipalId =>
        VirtualPrincipalId.FromStorage(_principalId);

    public GroupId GroupId => GroupId.FromStorage(_groupId);
}
