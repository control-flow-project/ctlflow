using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Domain.Storage;

public static partial class StorageBindings
{
    public static ValueTask ValidateAppStorageBindings(
        IReadOnlyList<PersistentStorage> requested,
        IReadOnlyList<AppStorageBindingFact> existing,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var existingById = existing.ToDictionary(item => item.StorageId);
        foreach (var storage in requested)
        {
            if (existingById.TryGetValue(storage.StorageId, out var binding)
                && binding.CapacityBytes != storage.CapacityBytes)
            {
                throw new ExecutionException(
                    ExecutionError.FailedPrecondition,
                    "App storage capacity is immutable");
            }
        }

        return ValueTask.CompletedTask;
    }
}
