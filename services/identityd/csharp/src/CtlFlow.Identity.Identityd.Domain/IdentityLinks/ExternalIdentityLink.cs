using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Tenants;

namespace CtlFlow.Identity.Identityd.Domain.IdentityLinks;

public class ExternalIdentityLink
{
    private string _accountId = null!;
    private string _externalLinkId = null!;
    private string _providerId = null!;
    private string _providerSubject = null!;
    private string _tenantId = null!;

    private ExternalIdentityLink()
    {
    }

    public ExternalIdentityLink(
        ExternalLinkId externalLinkId,
        TenantId tenantId,
        ProviderId providerId,
        ProviderSubject providerSubject,
        AccountId accountId,
        Revision revision)
    {
        _externalLinkId = externalLinkId.Value;
        _tenantId = tenantId.Value;
        _providerId = providerId.Value;
        _providerSubject = providerSubject.Value;
        _accountId = accountId.Value;
        Revision = revision;
    }

    public AccountId AccountId => AccountId.FromStorage(_accountId);

    public ExternalLinkId ExternalLinkId =>
        ExternalLinkId.FromStorage(_externalLinkId);

    public ProviderId ProviderId => ProviderId.FromStorage(_providerId);

    public ProviderSubject ProviderSubject =>
        ProviderSubject.FromStorage(_providerSubject);

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public Revision Revision { get; private set; } = null!;
}
