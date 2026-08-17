using CtlFlow.Execution.Execd.Domain.Identifiers;

namespace CtlFlow.Execution.Execd.Domain.Storage;

public sealed record AppStorageConsumerFact(
    PlacementId PlacementId,
    AppId AppId,
    StorageId StorageId,
    MountPath MountPath);
