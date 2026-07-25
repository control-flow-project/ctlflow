namespace CtlFlow.Tenancy.Tenantd.Db.Provisioning;

public class TenantInitialAdministrator
{
    private TenantInitialAdministrator()
    {
    }

    internal TenantInitialAdministrator(
        string tenantId,
        string displayName,
        string loginIdentifier,
        string? providerId,
        string? providerSubject)
    {
        TenantId = tenantId;
        DisplayName = displayName;
        LoginIdentifier = loginIdentifier;
        ProviderId = providerId;
        ProviderSubject = providerSubject;
    }

    public string TenantId { get; private set; } = string.Empty;

    public string DisplayName { get; private set; } = string.Empty;

    public string LoginIdentifier { get; private set; } = string.Empty;

    public string? ProviderId { get; private set; }

    public string? ProviderSubject { get; private set; }
}
