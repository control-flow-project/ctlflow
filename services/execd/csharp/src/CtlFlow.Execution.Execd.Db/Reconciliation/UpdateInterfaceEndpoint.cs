using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Db.Reconciliation;

public static partial class ReconciliationState
{
    public static async Task UpdateInterfaceEndpoint(
        ExecutionDatabase database,
        WorkloadId workloadId,
        Revision expectedWorkloadRevision,
        InterfaceId interfaceId,
        EndpointHost? host,
        bool ready,
        CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "update_interface_endpoint");
        await using var lease =
            await database.AcquireMutation(cancellation);
        var current = await Db.Workloads.Workloads.LoadWorkload(
            database,
            workloadId,
            cancellation);
        if (current is null)
        {
            return;
        }

        var updated = await Domain.Workloads.Workloads
            .ApplyInterfaceEndpoint(
                current,
                expectedWorkloadRevision,
                interfaceId,
                host,
                ready,
                cancellation);
        if (updated is null)
        {
            return;
        }

        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var row = new WorkloadInterface
        {
            WorkloadId = workloadId.Value,
            InterfaceId = interfaceId.Value,
            EndpointHost = updated.Host?.Value,
            Ready = updated.Ready
        };
        context.Attach(row);
        context.Entry(row)
            .Property(item => item.EndpointHost)
            .IsModified = true;
        context.Entry(row)
            .Property(item => item.Ready)
            .IsModified = true;
        await context.SaveChangesAsync(cancellation);
    }
}
