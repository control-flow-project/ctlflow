using System.Data.Common;
using CtlFlow.Configuration.V1;
using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Service.Configuration;
using CtlFlow.Execution.Execd.Service.Kubernetes;
using CtlFlow.Execution.Execd.Service.Telemetry;
using CtlFlow.Identity.V1;
using static CtlFlow.Execution.Execd.Db.Reconciliation.ReconciliationState;

namespace CtlFlow.Execution.Execd.Service.Reconciliation;

internal sealed class ExecutionReconciler(
    ExecutionDatabase database,
    KubernetesApi kubernetes,
    ConfigurationService.ConfigurationServiceClient configClient,
    IdentityService.IdentityServiceClient identityClient,
    ServiceSettings settings,
    ExecdTelemetry telemetry,
    ILogger<ExecutionReconciler> logger) : BackgroundService
{
    private const int StableSweepCycleInterval = 8;
    private static readonly Action<
        ILogger,
        string,
        string,
        int,
        Exception?> LogCycleFailure =
        LoggerMessage.Define<string, string, int>(
            LogLevel.Error,
            new EventId(10, "ExecdReconciliationFailed"),
            "Execd reconciliation cycle failed with {FailureKind}; "
            + "cause {CauseKind} ({CauseCode})");

    protected override async Task ExecuteAsync(
        CancellationToken stoppingToken)
    {
        var cycle = 0;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var includeStable =
                    cycle % StableSweepCycleInterval == 0;
                cycle = (cycle + 1) % StableSweepCycleInterval;
                var batch = await LoadReconciliationBatch(
                    database,
                    includeStable,
                    stoppingToken);
                foreach (var placement in batch.Placements)
                {
                    await ExecutionReconciliation.ReconcilePlacement(
                        database,
                        kubernetes,
                        placement,
                        stoppingToken);
                }

                foreach (var workload in batch.Workloads)
                {
                    await ExecutionReconciliation.ReconcileWorkload(
                        database,
                        kubernetes,
                        configClient,
                        settings.Configuration,
                        telemetry,
                        workload,
                        stoppingToken);
                }

                foreach (var run in batch.Runs)
                {
                    await ExecutionReconciliation.ReconcileRun(
                        database,
                        kubernetes,
                        identityClient,
                        settings.Identity,
                        telemetry,
                        run,
                        stoppingToken);
                }
            }
            catch (OperationCanceledException) when (
                stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                var cause = exception.InnerException as DbException
                    ?? exception as DbException;
                LogCycleFailure(
                    logger,
                    exception.GetType().Name,
                    cause?.GetType().Name ?? "none",
                    cause?.ErrorCode ?? 0,
                    null);
            }

            await Task.Delay(
                settings.Kubernetes.ReconcileInterval,
                stoppingToken);
        }
    }
}
