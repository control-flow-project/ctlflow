using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Domain.Storage;

public static partial class StorageBindings
{
    public static ValueTask<IReadOnlyList<PersistentStorage>>
        RestorePersistentStorage(
            PlacementId placementId,
            AppId appId,
            IReadOnlyList<AppStorageConsumerFact> consumers,
            IReadOnlyList<AppStorageBindingFact> bindings,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var bindingsById = bindings.ToDictionary(item => item.StorageId);
        var restored = new PersistentStorage[consumers.Count];
        for (var index = 0; index < consumers.Count; index++)
        {
            var consumer = consumers[index];
            if (consumer.PlacementId != placementId
                || consumer.AppId != appId
                || !bindingsById.TryGetValue(
                    consumer.StorageId,
                    out var binding))
            {
                throw new ExecutionException(
                    ExecutionError.Unavailable,
                    "Stored App storage binding is invalid");
            }

            restored[index] = new PersistentStorage(
                consumer.StorageId,
                consumer.MountPath,
                binding.CapacityBytes);
        }

        return ValueTask.FromResult<IReadOnlyList<PersistentStorage>>(
            restored);
    }
}
