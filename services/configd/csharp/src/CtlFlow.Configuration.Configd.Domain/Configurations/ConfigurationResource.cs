using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;
using CtlFlow.Configuration.Configd.Domain.Time;

namespace CtlFlow.Configuration.Configd.Domain.Configurations;

public class ConfigurationResource
{
    private string? _accountPrincipalId;
    private string _configurationId = null!;
    private string _consumerId = null!;
    private string _currentConfigurationVersionId = null!;
    private string _placementId = null!;
    private string _purpose = null!;
    private long _revision;
    private int _scopeKind;
    private string? _tenantId;
    private string? _workspaceId;

    private ConfigurationResource()
    {
    }

    internal ConfigurationResource(
        ConfigurationId id,
        ConsumerBinding binding,
        ConfigurationVersionId currentVersionId,
        Revision revision,
        UtcInstant createdAt,
        UtcInstant updatedAt)
    {
        _configurationId = id.Value;
        SetBinding(binding);
        _currentConfigurationVersionId = currentVersionId.Value;
        _revision = revision.Value;
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    public ConfigurationId Id =>
        ConfigurationId.FromStorage(_configurationId);

    public ConsumerBinding Binding => BindingStorage.FromStorage(
        _scopeKind,
        _placementId,
        _tenantId,
        _workspaceId,
        _accountPrincipalId,
        _consumerId,
        _purpose);

    public ConfigurationVersionId CurrentVersionId =>
        ConfigurationVersionId.FromStorage(_currentConfigurationVersionId);

    public Revision Revision => Revision.FromStorage(_revision);

    public UtcInstant CreatedAt { get; private set; } = null!;

    public UtcInstant UpdatedAt { get; private set; } = null!;

    internal void SelectVersion(
        ConfigurationVersionId versionId,
        UtcInstant updatedAt)
    {
        _currentConfigurationVersionId = versionId.Value;
        _revision = Revision.Next().Value;
        UpdatedAt = updatedAt;
    }

    private void SetBinding(ConsumerBinding binding)
    {
        _scopeKind = BindingStorage.GetScopeKind(binding);
        _placementId = binding.Placement.PlacementId.Value;
        _tenantId = BindingStorage.GetTenantId(binding);
        _workspaceId = BindingStorage.GetWorkspaceId(binding);
        _accountPrincipalId =
            BindingStorage.GetAccountPrincipalId(binding);
        _consumerId = binding.ConsumerId.Value;
        _purpose = binding.Purpose.Value;
    }
}
