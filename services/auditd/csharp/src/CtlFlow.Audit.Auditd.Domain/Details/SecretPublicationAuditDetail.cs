using CtlFlow.Audit.Auditd.Domain.Consumers;
using CtlFlow.Audit.Auditd.Domain.Dependencies;
using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Placements;
using CtlFlow.Audit.Auditd.Domain.Principals;
using CtlFlow.Audit.Auditd.Domain.Resources;
using CtlFlow.Audit.Auditd.Domain.Secrets;
using CtlFlow.Audit.Auditd.Domain.Tenants;
using CtlFlow.Audit.Auditd.Domain.Workspaces;
using static CtlFlow.Audit.Auditd.Domain.Events.AuditCanonicalization;

namespace CtlFlow.Audit.Auditd.Domain.Details;

public class SecretPublicationAuditDetail : AuditDetail
{
    private SecretPublicationAuditDetail()
    {
        SecretId = null!;
        SecretVersionId = null!;
        BindingPlacementId = null!;
        BindingConsumerId = null!;
        BindingPurpose = null!;
    }

    public SecretPublicationAuditDetail(
        SecretId secretId,
        SecretVersionId secretVersionId,
        ConsumerBinding binding,
        Revision identityRevision,
        DependencyClaimId? dependencyClaimId,
        Revision? dependencyClaimRevision)
        : base(AuditDetailKind.SecretPublication)
    {
        SecretId = secretId.Value;
        SecretVersionId = secretVersionId.Value;
        SetBinding(binding);
        IdentityRevision = identityRevision.Value;
        DependencyClaimId = dependencyClaimId?.Value;
        DependencyClaimRevision = dependencyClaimRevision?.Value;
    }

    internal string SecretId { get; private set; }
    internal string SecretVersionId { get; private set; }
    internal string BindingPlacementId { get; private set; } = null!;
    internal PlacementTargetKind BindingTargetKind { get; private set; }
    internal string? BindingTenantId { get; private set; }
    internal string? BindingWorkspaceId { get; private set; }
    internal string? BindingAccountPrincipalId { get; private set; }
    internal string BindingConsumerId { get; private set; } = null!;
    internal string BindingPurpose { get; private set; } = null!;
    internal long IdentityRevision { get; private set; }
    internal string? DependencyClaimId { get; private set; }
    internal long? DependencyClaimRevision { get; private set; }

    internal ConsumerBinding Binding => new(
        PlacementId.FromStorage(BindingPlacementId),
        new PlacementAuditTarget(
            BindingTargetKind,
            BindingTenantId is null
                ? null
                : TenantId.FromStorage(BindingTenantId),
            BindingWorkspaceId is null
                ? null
                : WorkspaceId.FromStorage(BindingWorkspaceId),
            BindingAccountPrincipalId is null
                ? null
                : AccountId.FromStorage(BindingAccountPrincipalId)),
        ConsumerId.FromStorage(BindingConsumerId),
        ConsumerPurpose.FromStorage(BindingPurpose));

    internal override void WriteCanonical(CanonicalHashWriter writer)
    {
        writer.Append(SecretId);
        writer.Append(SecretVersionId);
        WriteBinding(writer, Binding);
        writer.Append(IdentityRevision);
        writer.AppendOptional(DependencyClaimId);
        writer.AppendOptional(DependencyClaimRevision);
    }

    private void SetBinding(ConsumerBinding binding)
    {
        BindingPlacementId = binding.PlacementId.Value;
        BindingTargetKind = binding.Target.Kind;
        BindingTenantId = binding.Target.TenantId?.Value;
        BindingWorkspaceId = binding.Target.WorkspaceId?.Value;
        BindingAccountPrincipalId = binding.Target.AccountPrincipalId?.Value;
        BindingConsumerId = binding.ConsumerId.Value;
        BindingPurpose = binding.Purpose.Value;
    }
}
