using CtlFlow.Configuration.V1;
using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Time;
using CtlFlow.Execution.Execd.Domain.Workloads;
using CtlFlow.Execution.Execd.Service.Configuration;
using CtlFlow.Execution.Execd.Service.Kubernetes;
using CtlFlow.Execution.Execd.Service.Telemetry;
using static CtlFlow.Execution.Execd.Db.Placements.Placements;
using static CtlFlow.Execution.Execd.Db.Reconciliation.ReconciliationState;
using static CtlFlow.Execution.Execd.Db.Workloads.Workloads;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesApis;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesBodies;

namespace CtlFlow.Execution.Execd.Service.Reconciliation;

internal static partial class ExecutionReconciliation
{
    internal static async Task ReconcileWorkload(
        ExecutionDatabase database,
        KubernetesApi kubernetes,
        ConfigurationService.ConfigurationServiceClient configClient,
        ConfigurationSettings configSettings,
        ExecdTelemetry telemetry,
        WorkloadRecord workload,
        CancellationToken cancellation)
    {
        var now = CurrentInstant();
        try
        {
            var placement = await GetPlacement(
                database,
                workload.PlacementId,
                cancellation);
            // Admission derived and retained the subject; realization
            // consumes it rather than re-deriving names.
            var subject = Domain.Naming.NativeNames.ParseServiceAccountSubject(
                workload.ServiceAccountSubject);
            var namespaceName = subject.Namespace;
            if (workload.DesiredState == DesiredState.Retired)
            {
                await DeleteWorkloadObjects(
                    database,
                    kubernetes,
                    placement,
                    workload,
                    namespaceName,
                    cancellation);
                await UpdateWorkloadRealization(
                    database,
                    workload.Id,
                    workload.Revision,
                    RealizationPhase.Retired,
                    RealizationReason.None,
                    now,
                    cancellation);
                return;
            }

            if (!await IsPlacementEffectivelyActive(
                    database,
                    placement,
                    cancellation)
                || workload.DesiredState == DesiredState.Suspended)
            {
                await SuspendWorkload(
                    database,
                    kubernetes,
                    placement,
                    workload,
                    namespaceName,
                    cancellation);
                await UpdateWorkloadRealization(
                    database,
                    workload.Id,
                    workload.Revision,
                    RealizationPhase.Suspended,
                    RealizationReason.None,
                    now,
                    cancellation);
                return;
            }

            if (placement.Realization.Phase != RealizationPhase.Ready)
            {
                await UpdateWorkloadRealization(
                    database,
                    workload.Id,
                    workload.Revision,
                    RealizationPhase.Pending,
                    RealizationReason.PlacementNotReady,
                    now,
                    cancellation);
                return;
            }

            await ReconcileActiveWorkload(
                database,
                kubernetes,
                configClient,
                configSettings,
                telemetry,
                placement,
                workload,
                namespaceName,
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
            await RecordWorkloadFailure(
                database,
                workload,
                RealizationReason.OwnershipConflict,
                now,
                cancellation);
        }
        catch (KubernetesUnavailableException)
        {
            await RecordWorkloadFailure(
                database,
                workload,
                RealizationReason.KubernetesUnavailable,
                now,
                cancellation);
        }
        catch (ExecutionException)
        {
            await RecordWorkloadFailure(
                database,
                workload,
                RealizationReason.BindingUnavailable,
                now,
                cancellation);
        }
        catch (Exception exception) when (
            exception is InvalidDataException
                or InvalidOperationException
                or ArgumentException)
        {
            await RecordWorkloadFailure(
                database,
                workload,
                RealizationReason.RealizationRejected,
                now,
                cancellation);
        }
    }

    private static async Task ReconcileActiveWorkload(
        ExecutionDatabase database,
        KubernetesApi kubernetes,
        ConfigurationService.ConfigurationServiceClient configClient,
        ConfigurationSettings configSettings,
        ExecdTelemetry telemetry,
        Domain.Placements.PlacementRecord placement,
        WorkloadRecord workload,
        string namespaceName,
        UtcInstant now,
        CancellationToken cancellation)
    {
        var accountName = Domain.Naming.NativeNames.ParseServiceAccountSubject(
            workload.ServiceAccountSubject).Name;
        await EnsureOwnedObject(
            kubernetes,
            KubernetesResourcePaths.ServiceAccount(
                namespaceName,
                accountName),
            "ServiceAccount",
            accountName,
            WorkloadAnnotations(placement.Id, workload.Id),
            BuildServiceAccount(
                placement.Id,
                workload.Id,
                namespaceName,
                accountName),
            "workload_service_account",
            cancellation);
        await ReconcileWorkloadTrustConfigMap(
            kubernetes,
            placement,
            workload,
            namespaceName,
            cancellation);
        await ApplyWorkloadProjections(
            database,
            configClient,
            configSettings,
            telemetry,
            placement,
            workload,
            cancellation);
        workload = await GetWorkload(
            database,
            workload.Id,
            cancellation);

        var dependenciesReady = true;
        foreach (var dependency in workload.Dependencies)
        {
            dependenciesReady &= await ReconcileDependency(
                database,
                kubernetes,
                configClient,
                configSettings,
                telemetry,
                placement,
                workload,
                dependency,
                namespaceName,
                cancellation);
        }

        workload = await GetWorkload(
            database,
            workload.Id,
            cancellation);
        if (!dependenciesReady
            || !AllProjectionsAreResolved(workload))
        {
            await UpdateWorkloadRealization(
                database,
                workload.Id,
                workload.Revision,
                RealizationPhase.Degraded,
                RealizationReason.BindingUnavailable,
                now,
                cancellation);
            return;
        }

        if (!await EnsureWorkloadStorage(
                kubernetes,
                placement,
                workload,
                namespaceName,
                cancellation))
        {
            await UpdateWorkloadRealization(
                database,
                workload.Id,
                workload.Revision,
                RealizationPhase.Degraded,
                RealizationReason.StorageUnavailable,
                now,
                cancellation);
            return;
        }

        if (workload.Behavior is WorkloadBehavior.Finite)
        {
            await UpdateWorkloadRealization(
                database,
                workload.Id,
                workload.Revision,
                RealizationPhase.Ready,
                RealizationReason.None,
                now,
                cancellation);
            return;
        }

        var continuous = (WorkloadBehavior.Continuous)workload.Behavior;
        await ReconcileEdgedTrustConfigMap(
            kubernetes,
            placement,
            workload,
            namespaceName,
            cancellation);
        var deployment = await EnsureOwnedObject(
            kubernetes,
            KubernetesResourcePaths.Deployment(
                namespaceName,
                accountName),
            "Deployment",
            accountName,
            WorkloadAnnotations(placement.Id, workload.Id),
            BuildWorkloadDeployment(
                placement,
                workload,
                namespaceName,
                accountName,
                kubernetes.Settings.Edged,
                kubernetes.Settings.Bootstrap,
                continuous.Replicas),
            "workload_deployment",
            cancellation);
        var status = InspectDeployment(deployment);
        var ready = status.ObservedGeneration >= status.Generation
            && status.AvailableReplicas >= continuous.Replicas
            && status.Replicas == continuous.Replicas
            && status.UpdatedReplicas == continuous.Replicas;
        await EnsureWorkloadServices(
            database,
            kubernetes,
            placement,
            workload,
            namespaceName,
            accountName,
            ready,
            cancellation);
        await UpdateWorkloadRealization(
            database,
            workload.Id,
            workload.Revision,
            ready
                ? RealizationPhase.Ready
                : RealizationPhase.Degraded,
            ready
                ? RealizationReason.None
                : RealizationReason.ExecutionUnready,
            now,
            cancellation);
    }

    private static async Task RecordWorkloadFailure(
        ExecutionDatabase database,
        WorkloadRecord workload,
        RealizationReason reason,
        UtcInstant now,
        CancellationToken cancellation) =>
        await UpdateWorkloadRealization(
            database,
            workload.Id,
            workload.Revision,
            RealizationPhase.Degraded,
            reason,
            now,
            cancellation);

    private static UtcInstant CurrentInstant() =>
        UtcInstant.FromStorage(
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
}
