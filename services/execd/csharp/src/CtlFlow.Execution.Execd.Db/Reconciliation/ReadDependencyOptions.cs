using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Execution.Execd.Db.Reconciliation;

public static partial class ReconciliationState
{
    public static async Task<DependencyOptionsLease>
        ReadDependencyOptions(
            ExecutionDatabase database,
            WorkloadId workloadId,
            ComponentId componentId,
            DependencyName dependencyName,
            CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "read_dependency_options");
        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var workload = workloadId.Value;
        var component = componentId.Value;
        var dependency = dependencyName.Value;
        var queryCancellation = cancellation;
        var content = await context.WorkloadDependencies
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "WorkloadId") == workload
                && EF.Property<string>(item, "ComponentId")
                    == component
                && EF.Property<string>(item, "DependencyName")
                    == dependency)
            .Select(item =>
                EF.Property<byte[]>(item, "OptionsJson"))
            .SingleOrDefaultAsync(queryCancellation)
            ?? throw new InvalidOperationException(
                "Dependency options disappeared");
        return new DependencyOptionsLease(content);
    }
}
