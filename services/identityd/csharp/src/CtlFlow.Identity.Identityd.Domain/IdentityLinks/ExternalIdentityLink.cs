using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Tenants;

namespace CtlFlow.Identity.Identityd.Domain.IdentityLinks;

public class ExternalIdentityLink
{
    private string _accountId = null!;
    private string _providerId = null!;
    private string _providerSubject = null!;
    private string _tenantId = null!;

    private ExternalIdentityLink()
    {
    }

    public AccountId AccountId => AccountId.FromStorage(_accountId);

    public ProviderId ProviderId => ProviderId.FromStorage(_providerId);

    public ProviderSubject ProviderSubject =>
        ProviderSubject.FromStorage(_providerSubject);

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public Revision Revision { get; private set; } = null!;
}
