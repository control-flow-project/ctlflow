using CtlFlow.Audit.Auditd.Domain.Apps;
using CtlFlow.Audit.Auditd.Domain.Components;
using CtlFlow.Audit.Auditd.Domain.Packages;
using CtlFlow.Audit.Auditd.Domain.Placements;
using CtlFlow.Audit.Auditd.Domain.Principals;
using CtlFlow.Audit.Auditd.Domain.Runs;
using CtlFlow.Audit.Auditd.Domain.Workloads;
using DomainPlacementMutation =
    CtlFlow.Audit.Auditd.Domain.Details.PlacementMutationAuditDetail;
using DomainRunMutation =
    CtlFlow.Audit.Auditd.Domain.Details.RunMutationAuditDetail;
using DomainWorkloadMutation =
    CtlFlow.Audit.Auditd.Domain.Details.WorkloadMutationAuditDetail;
using WirePlacementMutation =
    CtlFlow.Audit.V1.PlacementMutationAuditDetail;
using WireRunMutation =
    CtlFlow.Audit.V1.RunMutationAuditDetail;
using WireWorkloadMutation =
    CtlFlow.Audit.V1.WorkloadMutationAuditDetail;

namespace CtlFlow.Audit.Auditd.Service.Grpc.Requests;

internal static partial class AuditRequests
{
    private static async ValueTask<DomainPlacementMutation>
        MapPlacementMutation(
        WirePlacementMutation value,
        CancellationToken cancellation) =>
        new(
            await PlacementId.Parse(value.PlacementId, cancellation),
            await MapPlacementTarget(value.Target, cancellation),
            MapPlacementAction(value.Action),
            await ParseRevision(
                value.PlacementRevision,
                cancellation),
            MapDesiredState(value.ResultingDesiredState));

    private static async ValueTask<DomainWorkloadMutation>
        MapWorkloadMutation(
        WireWorkloadMutation value,
        CancellationToken cancellation) =>
        new(
            await WorkloadId.Parse(value.WorkloadId, cancellation),
            await PlacementId.Parse(value.PlacementId, cancellation),
            await MapPlacementTarget(
                value.PlacementTarget,
                cancellation),
            MapWorkloadAction(value.Action),
            await ParseRevision(value.WorkloadRevision, cancellation),
            MapDesiredState(value.ResultingDesiredState),
            await AppId.Parse(value.AppId, cancellation),
            await ParseRevision(value.AppRevision, cancellation),
            await PackageId.Parse(value.PackageId, cancellation),
            await ParseGeneration(
                value.PackageGeneration,
                cancellation),
            await ComponentId.Parse(value.ComponentId, cancellation));

    private static async ValueTask<DomainRunMutation> MapRunMutation(
        WireRunMutation value,
        CancellationToken cancellation) =>
        new(
            await RunId.Parse(value.RunId, cancellation),
            await WorkloadId.Parse(value.WorkloadId, cancellation),
            await PlacementId.Parse(value.PlacementId, cancellation),
            await MapPlacementTarget(
                value.PlacementTarget,
                cancellation),
            MapRunAction(value.Action),
            await ParseRevision(value.RunRevision, cancellation),
            value.HasConfiguredActorPrincipalId
                ? await PrincipalId.Parse(
                    value.ConfiguredActorPrincipalId,
                    cancellation)
                : null);
}
