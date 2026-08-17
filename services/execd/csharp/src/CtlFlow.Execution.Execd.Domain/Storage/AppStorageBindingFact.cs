using CtlFlow.Execution.Execd.Domain.Identifiers;

namespace CtlFlow.Execution.Execd.Domain.Storage;

public sealed record AppStorageBindingFact(
    StorageId StorageId,
    long CapacityBytes);
