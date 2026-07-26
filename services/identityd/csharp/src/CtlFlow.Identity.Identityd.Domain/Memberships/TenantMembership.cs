using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Tenants;

namespace CtlFlow.Identity.Identityd.Domain.Memberships;

public class TenantMembership
{
    private string _accountId = null!;
    private string _tenantId = null!;

    private TenantMembership()
    {
    }

    public AccountId AccountId => AccountId.FromStorage(_accountId);

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public Revision Revision { get; private set; } = null!;
}
