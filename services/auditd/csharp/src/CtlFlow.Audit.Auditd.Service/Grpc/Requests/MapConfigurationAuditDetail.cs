using CtlFlow.Audit.Auditd.Domain.Configurations;
using CtlFlow.Audit.Auditd.Domain.Dependencies;
using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Projections;
using CtlFlow.Audit.Auditd.Domain.Resources;
using CtlFlow.Audit.Auditd.Domain.Secrets;
using DomainConfigurationPublication =
    CtlFlow.Audit.Auditd.Domain.Details.ConfigurationPublicationAuditDetail;
using DomainProjectionMutation =
    CtlFlow.Audit.Auditd.Domain.Details.ProjectionMutationAuditDetail;
using DomainProjectionTargetKind =
    CtlFlow.Audit.Auditd.Domain.Events.ProjectionTargetKind;
using DomainSecretPublication =
    CtlFlow.Audit.Auditd.Domain.Details.SecretPublicationAuditDetail;
using WireConfigurationPublication =
    CtlFlow.Audit.V1.ConfigurationPublicationAuditDetail;
using WireProjectionMutation =
    CtlFlow.Audit.V1.ProjectionMutationAuditDetail;
using WireSecretPublication =
    CtlFlow.Audit.V1.SecretPublicationAuditDetail;

namespace CtlFlow.Audit.Auditd.Service.Grpc.Requests;

internal static partial class AuditRequests
{
    private static async ValueTask<DomainConfigurationPublication>
        MapConfigurationPublication(
            WireConfigurationPublication value,
            CancellationToken cancellation)
    {
        var target = value.Target
            ?? throw new ArgumentException(
                "Configuration target is required");
        return new DomainConfigurationPublication(
            await ConfigurationId.Parse(
                target.ConfigurationId,
                cancellation),
            await ConfigurationVersionId.Parse(
                target.ConfigurationVersionId,
                cancellation),
            await MapConsumerBinding(value.Binding, cancellation),
            await ParseRevision(value.IdentityRevision, cancellation),
            value.HasDependencyClaimId
                ? await DependencyClaimId.Parse(
                    value.DependencyClaimId,
                    cancellation)
                : null,
            value.HasDependencyClaimRevision
                ? await ParseRevision(
                    value.DependencyClaimRevision,
                    cancellation)
                : null);
    }

    private static async ValueTask<DomainSecretPublication>
        MapSecretPublication(
        WireSecretPublication value,
        CancellationToken cancellation)
    {
        var target = value.Target
            ?? throw new ArgumentException("Secret target is required");
        return new DomainSecretPublication(
            await SecretId.Parse(target.SecretId, cancellation),
            await SecretVersionId.Parse(
                target.SecretVersionId,
                cancellation),
            await MapConsumerBinding(value.Binding, cancellation),
            await ParseRevision(value.IdentityRevision, cancellation),
            value.HasDependencyClaimId
                ? await DependencyClaimId.Parse(
                    value.DependencyClaimId,
                    cancellation)
                : null,
            value.HasDependencyClaimRevision
                ? await ParseRevision(
                    value.DependencyClaimRevision,
                    cancellation)
                : null);
    }

    private static async ValueTask<DomainProjectionMutation>
        MapProjectionMutation(
        WireProjectionMutation value,
        CancellationToken cancellation)
    {
        var target = value.TargetCase switch
        {
            WireProjectionMutation.TargetOneofCase.Configuration =>
                new ProjectionAuditTarget(
                    DomainProjectionTargetKind.Configuration,
                    await ConfigurationId.Parse(
                        value.Configuration.ConfigurationId,
                        cancellation),
                    await ConfigurationVersionId.Parse(
                        value.Configuration.ConfigurationVersionId,
                        cancellation),
                    null,
                    null),
            WireProjectionMutation.TargetOneofCase.Secret =>
                new ProjectionAuditTarget(
                    DomainProjectionTargetKind.Secret,
                    null,
                    null,
                    await SecretId.Parse(
                        value.Secret.SecretId,
                        cancellation),
                    await SecretVersionId.Parse(
                        value.Secret.SecretVersionId,
                        cancellation)),
            _ => throw new ArgumentException(
                "Projection target is required")
        };
        return new DomainProjectionMutation(
            await ProjectionId.Parse(
                value.ProjectionId,
                cancellation),
            MapProjectionAction(value.Action),
            await ParseRevision(
                value.ProjectionRevision,
                cancellation),
            target,
            await MapConsumerBinding(value.Binding, cancellation));
    }
}
