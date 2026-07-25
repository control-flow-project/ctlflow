namespace CtlFlow.Tenancy.Tenantd.Domain.Provisioning;

public sealed record IdentityLinkIntent(
    IdentityProviderId ProviderId,
    ProviderSubject ProviderSubject);
