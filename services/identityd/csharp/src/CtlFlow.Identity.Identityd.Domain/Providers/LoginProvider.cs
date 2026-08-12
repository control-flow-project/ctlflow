using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Tenants;

namespace CtlFlow.Identity.Identityd.Domain.Providers;

public class LoginProvider
{
    private string _tenantId = null!;
    private string _providerId = null!;
    private string _displayName = null!;
    private string _configurationId = null!;
    private string _configurationVersionId = null!;
    private string _secretId = null!;
    private string _secretVersionId = null!;

    private LoginProvider()
    {
    }

    public LoginProvider(
        TenantId tenantId,
        ProviderId providerId,
        ProviderDisplayName displayName,
        ConfigurationId configurationId,
        ConfigurationVersionId configurationVersionId,
        SecretId secretId,
        SecretVersionId secretVersionId,
        LoginProviderState state,
        Revision revision)
    {
        _tenantId = tenantId.Value;
        _providerId = providerId.Value;
        _displayName = displayName.Value;
        _configurationId = configurationId.Value;
        _configurationVersionId = configurationVersionId.Value;
        _secretId = secretId.Value;
        _secretVersionId = secretVersionId.Value;
        State = state;
        Revision = revision;
    }

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public ProviderId ProviderId => ProviderId.FromStorage(_providerId);

    public ProviderDisplayName DisplayName =>
        ProviderDisplayName.FromStorage(_displayName);

    public ConfigurationId ConfigurationId =>
        ConfigurationId.FromStorage(_configurationId);

    public ConfigurationVersionId ConfigurationVersionId =>
        ConfigurationVersionId.FromStorage(_configurationVersionId);

    public SecretId SecretId => SecretId.FromStorage(_secretId);

    public SecretVersionId SecretVersionId =>
        SecretVersionId.FromStorage(_secretVersionId);

    public LoginProviderState State { get; private set; }

    public Revision Revision { get; private set; } = null!;

    internal void Update(
        ProviderDisplayName displayName,
        ConfigurationId configurationId,
        ConfigurationVersionId configurationVersionId,
        SecretId secretId,
        SecretVersionId secretVersionId)
    {
        _displayName = displayName.Value;
        _configurationId = configurationId.Value;
        _configurationVersionId = configurationVersionId.Value;
        _secretId = secretId.Value;
        _secretVersionId = secretVersionId.Value;
        Revision = Revision.Next();
    }

    internal void SetState(LoginProviderState state)
    {
        State = state;
        Revision = Revision.Next();
    }
}
