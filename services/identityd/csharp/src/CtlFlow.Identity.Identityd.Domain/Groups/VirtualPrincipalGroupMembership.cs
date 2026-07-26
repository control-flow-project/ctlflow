using CtlFlow.Identity.Identityd.Domain.Principals;

namespace CtlFlow.Identity.Identityd.Domain.Groups;

public class VirtualPrincipalGroupMembership
{
    private string _principalId = null!;
    private string _groupId = null!;

    private VirtualPrincipalGroupMembership()
    {
    }

    public VirtualPrincipalId PrincipalId =>
        VirtualPrincipalId.FromStorage(_principalId);

    public GroupId GroupId => GroupId.FromStorage(_groupId);
}
