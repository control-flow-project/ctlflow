using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Service.Kubernetes;
using static CtlFlow.Execution.Execd.Db.Reconciliation.ReconciliationState;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesApis;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesBodies;

namespace CtlFlow.Execution.Execd.Service.Reconciliation;

internal static partial class ExecutionReconciliation
{
    internal static async Task ReconcilePlacement(
        ExecutionDatabase database,
        KubernetesApi kubernetes,
        PlacementRecord placement,
        CancellationToken cancellation)
    {
        var now = CurrentInstant();
        try
        {
            var namespaceName = NativeNames.PlacementNamespace(
                placement.Id);
            if (placement.DesiredState == DesiredState.Retired)
            {
                await DeleteOwnedObject(
                    kubernetes,
                    KubernetesResourcePaths.Namespace(namespaceName),
                    "Namespace",
                    namespaceName,
                    PlacementAnnotations(placement.Id),
                    "placement_namespace",
                    cancellation);
                await UpdatePlacementRealization(
                    database,
                    placement.Id,
                    placement.Revision,
                    RealizationPhase.Retired,
                    RealizationReason.None,
                    now,
                    cancellation);
                return;
            }

            await EnsureOwnedObject(
                kubernetes,
                KubernetesResourcePaths.Namespace(namespaceName),
                "Namespace",
                namespaceName,
                PlacementAnnotations(placement.Id),
                BuildNamespace(placement.Id, namespaceName),
                "placement_namespace",
                cancellation);
            var active = await IsPlacementEffectivelyActive(
                database,
                placement,
                cancellation);
            await UpdatePlacementRealization(
                database,
                placement.Id,
                placement.Revision,
                active
                    ? RealizationPhase.Ready
                    : RealizationPhase.Suspended,
                RealizationReason.None,
                now,
                cancellation);
        }
        catch (OperationCanceledException) when (
            cancellation.IsCancellationRequested)
        {
            throw;
        }
        catch (KubernetesOwnershipCollisionException)
        {
            await RecordPlacementFailure(
                database,
                placement,
                RealizationReason.OwnershipConflict,
                now,
                cancellation);
        }
        catch (KubernetesUnavailableException)
        {
            await RecordPlacementFailure(
                database,
                placement,
                RealizationReason.KubernetesUnavailable,
                now,
                cancellation);
        }
        catch (Exception exception) when (
            exception is InvalidDataException
                or InvalidOperationException
                or ArgumentException)
        {
            await RecordPlacementFailure(
                database,
                placement,
                RealizationReason.RealizationRejected,
                now,
                cancellation);
        }
    }

    private static async Task RecordPlacementFailure(
        ExecutionDatabase database,
        PlacementRecord placement,
        RealizationReason reason,
        Domain.Time.UtcInstant now,
        CancellationToken cancellation) =>
        await UpdatePlacementRealization(
            database,
            placement.Id,
            placement.Revision,
            RealizationPhase.Degraded,
            reason,
            now,
            cancellation);
}
