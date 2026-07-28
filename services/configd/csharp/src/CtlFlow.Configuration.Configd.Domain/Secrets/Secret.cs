using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;
using CtlFlow.Configuration.Configd.Domain.Time;

namespace CtlFlow.Configuration.Configd.Domain.Secrets;

public class Secret
{
    private string? _accountPrincipalId;
    private string _consumerId = null!;
    private string _currentSecretVersionId = null!;
    private string _placementId = null!;
    private string _purpose = null!;
    private long _revision;
    private string _secretId = null!;
    private int _scopeKind;
    private string? _tenantId;
    private string? _workspaceId;

    private Secret()
    {
    }

    internal Secret(
        SecretId id,
        ConsumerBinding binding,
        SecretVersionId currentVersionId,
        Revision revision,
        UtcInstant createdAt,
        UtcInstant updatedAt)
    {
        _secretId = id.Value;
        SetBinding(binding);
        _currentSecretVersionId = currentVersionId.Value;
        _revision = revision.Value;
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    public SecretId Id => SecretId.FromStorage(_secretId);

    public ConsumerBinding Binding => BindingStorage.FromStorage(
        _scopeKind,
        _placementId,
        _tenantId,
        _workspaceId,
        _accountPrincipalId,
        _consumerId,
        _purpose);

    public SecretVersionId CurrentVersionId =>
        SecretVersionId.FromStorage(_currentSecretVersionId);

    public Revision Revision => Revision.FromStorage(_revision);

    public UtcInstant CreatedAt { get; private set; } = null!;

    public UtcInstant UpdatedAt { get; private set; } = null!;

    internal void SelectVersion(
        SecretVersionId versionId,
        UtcInstant updatedAt)
    {
        _currentSecretVersionId = versionId.Value;
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
