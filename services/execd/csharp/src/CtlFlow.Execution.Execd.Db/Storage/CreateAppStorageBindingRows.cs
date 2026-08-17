using CtlFlow.Execution.Execd.Domain.Storage;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Db.Storage;

public static partial class StorageBindings
{
    public static AppStorageBinding[] CreateAppStorageBindingRows(
        WorkloadDraft draft,
        IReadOnlyList<AppStorageBindingFact> existing)
    {
        var retained = existing
            .Select(item => item.StorageId)
            .ToHashSet();
        return draft.Storage
            .Where(item => !retained.Contains(item.StorageId))
            .Select(item => new AppStorageBinding
            {
                PlacementId = draft.PlacementId.Value,
                AppId = draft.AdmittedPackage.AppId.Value,
                StorageId = item.StorageId.Value,
                CapacityBytes = item.CapacityBytes
            })
            .ToArray();
    }
}
