using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Runs;
using CtlFlow.Execution.Execd.Domain.Workloads;
using CtlFlow.Execution.Execd.Service.Configuration;
using CtlFlow.Execution.Execd.Service.Kubernetes;
using CtlFlow.Execution.Execd.Service.Telemetry;
using CtlFlow.Identity.V1;
using static CtlFlow.Execution.Execd.Db.Placements.Placements;
using static CtlFlow.Execution.Execd.Db.Reconciliation.ReconciliationState;
using static CtlFlow.Execution.Execd.Db.Workloads.Workloads;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesApis;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesBodies;

namespace CtlFlow.Execution.Execd.Service.Reconciliation;

internal static partial class ExecutionReconciliation
{
    internal static async Task ReconcileRun(
        ExecutionDatabase database,
        KubernetesApi kubernetes,
        IdentityService.IdentityServiceClient identityClient,
        IdentitySettings identitySettings,
        ExecdTelemetry telemetry,
        RunRecord run,
        CancellationToken cancellation)
    {
        var now = CurrentInstant();
        var namespaceName = NativeNames.PlacementNamespace(
            run.PlacementId);
        try
        {
            if (run.Phase == RunPhase.Cancelling)
            {
                if (!await CancelKubernetesRun(
                        kubernetes,
                        run,
                        namespaceName,
                        cancellation))
                {
                    return;
                }

                await UpdateRunState(
                    database,
                    run.Id,
                    run.Revision,
                    RunPhase.Cancelled,
                    RunReason.CancelRequested,
                    run.AttemptCount,
                    run.StartedAt,
                    now,
                    now,
                    cancellation);
                return;
            }

            var jobName = NativeNames.RunJob(run.Id);
            var jobPath = KubernetesResourcePaths.Job(
                namespaceName,
                jobName);
            var existing = await GetObject(
                kubernetes,
                jobPath,
                "get_run_job",
                cancellation);
            if (existing.Document is null
                && !await CanLaunchRun(
                    database,
                    run,
                    cancellation))
            {
                return;
            }

            var invocationSecret = await EnsureRunInvocation(
                kubernetes,
                identityClient,
                identitySettings,
                telemetry,
                run,
                namespaceName,
                DateTimeOffset.UtcNow,
                cancellation);
            // The Run launches under the identity admission retained.
            var runWorkload = await GetWorkload(
                database,
                run.WorkloadId,
                cancellation);
            var accountName = Domain.Naming.NativeNames.ParseServiceAccountSubject(
                runWorkload.ServiceAccountSubject).Name;
            var document = await EnsureOwnedObject(
                kubernetes,
                jobPath,
                "Job",
                jobName,
                RunAnnotations(
                    run.PlacementId,
                    run.WorkloadId,
                    run.Id),
                BuildRunJob(
                    run,
                    namespaceName,
                    accountName,
                    jobName,
                    invocationSecret,
                    kubernetes.Settings.Bootstrap),
                "run_job",
                cancellation);
            var status = InspectJob(
                document,
                run.Execution.MaxAttempts);
            if (status.Phase is RunPhase.Succeeded
                or RunPhase.Failed)
            {
                await DeleteRunInvocation(
                    kubernetes,
                    run,
                    namespaceName,
                    cancellation);
            }

            await UpdateRunState(
                database,
                run.Id,
                run.Revision,
                status.Phase,
                status.Reason,
                status.AttemptCount,
                status.StartedAt,
                status.CompletedAt,
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
            await RecordRunFailure(
                database,
                run,
                RunReason.OwnershipConflict,
                now,
                cancellation);
        }
        catch (KubernetesUnavailableException)
        {
            await RecordRunFailure(
                database,
                run,
                RunReason.KubernetesUnavailable,
                now,
                cancellation);
        }
        catch (ExecutionException exception)
        {
            await RecordRunFailure(
                database,
                run,
                exception.Error == ExecutionError.FailedPrecondition
                    ? RunReason.InvocationNotAdmitted
                    : RunReason.InvocationUnavailable,
                now,
                cancellation);
        }
        catch (Exception exception) when (
            exception is InvalidDataException
                or InvalidOperationException
                or ArgumentException)
        {
            await RecordRunFailure(
                database,
                run,
                RunReason.RealizationRejected,
                now,
                cancellation);
        }
    }

    private static async Task<bool> CanLaunchRun(
        ExecutionDatabase database,
        RunRecord run,
        CancellationToken cancellation)
    {
        var placement = await GetPlacement(
            database,
            run.PlacementId,
            cancellation);
        if (!await IsPlacementEffectivelyActive(
                database,
                placement,
                cancellation))
        {
            await UpdateRunState(
                database,
                run.Id,
                run.Revision,
                RunPhase.Pending,
                RunReason.PlacementInactive,
                run.AttemptCount,
                run.StartedAt,
                null,
                CurrentInstant(),
                cancellation);
            return false;
        }

        var workload = await GetWorkload(
            database,
            run.WorkloadId,
            cancellation);
        if (workload.DesiredState != DesiredState.Active)
        {
            await UpdateRunState(
                database,
                run.Id,
                run.Revision,
                RunPhase.Pending,
                RunReason.WorkloadInactive,
                run.AttemptCount,
                run.StartedAt,
                null,
                CurrentInstant(),
                cancellation);
            return false;
        }

        if (workload.Realization.Phase != RealizationPhase.Ready)
        {
            await UpdateRunState(
                database,
                run.Id,
                run.Revision,
                RunPhase.Pending,
                RunReason.BindingUnavailable,
                run.AttemptCount,
                run.StartedAt,
                null,
                CurrentInstant(),
                cancellation);
            return false;
        }

        return true;
    }

    private static async Task<bool> CancelKubernetesRun(
        KubernetesApi kubernetes,
        RunRecord run,
        string namespaceName,
        CancellationToken cancellation)
    {
        var jobName = NativeNames.RunJob(run.Id);
        var path = KubernetesResourcePaths.Job(namespaceName, jobName);
        var job = await GetObject(
            kubernetes,
            path,
            "get_run_job",
            cancellation);
        if (job.Document is not null)
        {
            await DeleteOwnedObject(
                kubernetes,
                path,
                "Job",
                jobName,
                RunAnnotations(
                    run.PlacementId,
                    run.WorkloadId,
                    run.Id),
                "run_job",
                cancellation);
            return false;
        }

        await DeleteRunInvocation(
            kubernetes,
            run,
            namespaceName,
            cancellation);
        return true;
    }

    private static async Task RecordRunFailure(
        ExecutionDatabase database,
        RunRecord run,
        RunReason reason,
        Domain.Time.UtcInstant now,
        CancellationToken cancellation) =>
        await UpdateRunState(
            database,
            run.Id,
            run.Revision,
            run.Phase is RunPhase.Running
                ? RunPhase.Running
                : RunPhase.Pending,
            reason,
            run.AttemptCount,
            run.StartedAt,
            null,
            now,
            cancellation);
}
