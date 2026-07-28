using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Auditing;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;
using CtlFlow.Configuration.Configd.Domain.Time;

namespace CtlFlow.Configuration.Configd.Domain.Projections;

public class Projection
{
    private string? _accountPrincipalId;
    private string _auditEventId = null!;
    private string _consumerId = null!;
    private string _currentTargetVersionId = null!;
    private int _dataKind;
    private string _placementId = null!;
    private string _projectionId = null!;
    private string _purpose = null!;
    private long _revision;
    private int _scopeKind;
    private string _targetIdentityId = null!;
    private string? _tenantId;
    private string? _workspaceId;

    private Projection()
    {
    }

    internal Projection(
        ProjectionId id,
        ProjectionTarget target,
        ConsumerBinding binding,
        Revision revision,
        AuditEventId auditEventId,
        UtcInstant createdAt,
        UtcInstant updatedAt)
    {
        _projectionId = id.Value;
        SetTarget(target);
        SetBinding(binding);
        _revision = revision.Value;
        _auditEventId = auditEventId.Value;
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    public ProjectionId Id => ProjectionId.FromStorage(_projectionId);

    public ProjectionTarget Target => _dataKind switch
    {
        (int)ProjectionDataKind.Configuration =>
            new ProjectionTarget.Configuration(
                ConfigurationId.FromStorage(_targetIdentityId),
                ConfigurationVersionId.FromStorage(
                    _currentTargetVersionId)),
        (int)ProjectionDataKind.Secret =>
            new ProjectionTarget.Secret(
                SecretId.FromStorage(_targetIdentityId),
                SecretVersionId.FromStorage(_currentTargetVersionId)),
        _ => throw new InvalidOperationException(
            "Stored projection target is invalid")
    };

    public ConsumerBinding Binding => BindingStorage.FromStorage(
        _scopeKind,
        _placementId,
        _tenantId,
        _workspaceId,
        _accountPrincipalId,
        _consumerId,
        _purpose);

    public Revision Revision => Revision.FromStorage(_revision);

    public AuditEventId AuditEventId =>
        AuditEventId.FromStorage(_auditEventId);

    public UtcInstant CreatedAt { get; private set; } = null!;

    public UtcInstant UpdatedAt { get; private set; } = null!;

    internal void SelectTarget(
        ProjectionTarget target,
        AuditEventId auditEventId,
        UtcInstant updatedAt)
    {
        if (target.Kind != Target.Kind
            || GetTargetIdentity(target) != GetTargetIdentity(Target))
        {
            throw new InvalidOperationException(
                "Projection target identity is immutable");
        }

        SetTarget(target);
        _revision = Revision.Next().Value;
        _auditEventId = auditEventId.Value;
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

    private void SetTarget(ProjectionTarget target)
    {
        _dataKind = (int)target.Kind;
        _targetIdentityId = GetTargetIdentity(target);
        _currentTargetVersionId = GetTargetVersion(target);
    }

    private static string GetTargetIdentity(ProjectionTarget target) =>
        target switch
        {
            ProjectionTarget.Configuration configuration =>
                configuration.ConfigurationId.Value,
            ProjectionTarget.Secret secret => secret.SecretId.Value,
            _ => throw new InvalidOperationException(
                "Projection target is invalid")
        };

    private static string GetTargetVersion(ProjectionTarget target) =>
        target switch
        {
            ProjectionTarget.Configuration configuration =>
                configuration.VersionId.Value,
            ProjectionTarget.Secret secret => secret.VersionId.Value,
            _ => throw new InvalidOperationException(
                "Projection target is invalid")
        };
}
