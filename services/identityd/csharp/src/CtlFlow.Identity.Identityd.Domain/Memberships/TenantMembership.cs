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

    public TenantMembership(
        AccountId accountId,
        TenantId tenantId,
        Revision revision)
    {
        _accountId = accountId.Value;
        _tenantId = tenantId.Value;
        Revision = revision;
    }

    public AccountId AccountId => AccountId.FromStorage(_accountId);

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public Revision Revision { get; private set; } = null!;
}
