using CtlFlow.Audit.Auditd.Domain.Configurations;
using CtlFlow.Audit.Auditd.Domain.Consumers;
using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Placements;
using CtlFlow.Audit.Auditd.Domain.Principals;
using CtlFlow.Audit.Auditd.Domain.Projections;
using CtlFlow.Audit.Auditd.Domain.Resources;
using CtlFlow.Audit.Auditd.Domain.Secrets;
using CtlFlow.Audit.Auditd.Domain.Tenants;
using CtlFlow.Audit.Auditd.Domain.Workspaces;
using static CtlFlow.Audit.Auditd.Domain.Events.AuditCanonicalization;

namespace CtlFlow.Audit.Auditd.Domain.Details;

public class ProjectionMutationAuditDetail : AuditDetail
{
    private ProjectionMutationAuditDetail()
    {
        ProjectionId = null!;
        BindingPlacementId = null!;
        BindingConsumerId = null!;
        BindingPurpose = null!;
    }

    public ProjectionMutationAuditDetail(
        ProjectionId projectionId,
        ProjectionAuditAction action,
        Revision projectionRevision,
        ProjectionAuditTarget target,
        ConsumerBinding binding)
        : base(AuditDetailKind.ProjectionMutation)
    {
        ProjectionId = projectionId.Value;
        Action = (int)action;
        ProjectionRevision = projectionRevision.Value;
        TargetKind = target.Kind;
        ConfigurationId = target.ConfigurationId?.Value;
        ConfigurationVersionId = target.ConfigurationVersionId?.Value;
        SecretId = target.SecretId?.Value;
        SecretVersionId = target.SecretVersionId?.Value;
        SetBinding(binding);
    }

    internal string ProjectionId { get; private set; }
    internal int Action { get; private set; }
    internal long ProjectionRevision { get; private set; }
    internal ProjectionTargetKind TargetKind { get; private set; }
    internal string? ConfigurationId { get; private set; }
    internal string? ConfigurationVersionId { get; private set; }
    internal string? SecretId { get; private set; }
    internal string? SecretVersionId { get; private set; }
    internal string BindingPlacementId { get; private set; } = null!;
    internal PlacementTargetKind BindingTargetKind { get; private set; }
    internal string? BindingTenantId { get; private set; }
    internal string? BindingWorkspaceId { get; private set; }
    internal string? BindingAccountPrincipalId { get; private set; }
    internal string BindingConsumerId { get; private set; } = null!;
    internal string BindingPurpose { get; private set; } = null!;

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
        writer.Append(ProjectionId);
        writer.Append(Action);
        writer.Append(ProjectionRevision);
        writer.Append((int)TargetKind);
        writer.AppendOptional(ConfigurationId);
        writer.AppendOptional(ConfigurationVersionId);
        writer.AppendOptional(SecretId);
        writer.AppendOptional(SecretVersionId);
        WriteBinding(writer, Binding);
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
