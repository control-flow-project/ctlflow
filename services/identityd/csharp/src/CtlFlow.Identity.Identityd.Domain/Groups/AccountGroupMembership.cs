using CtlFlow.Identity.Identityd.Domain.Accounts;

namespace CtlFlow.Identity.Identityd.Domain.Groups;

public class AccountGroupMembership
{
    private string _accountId = null!;
    private string _groupId = null!;

    private AccountGroupMembership()
    {
    }

    public AccountId AccountId => AccountId.FromStorage(_accountId);

    public GroupId GroupId => GroupId.FromStorage(_groupId);
}
