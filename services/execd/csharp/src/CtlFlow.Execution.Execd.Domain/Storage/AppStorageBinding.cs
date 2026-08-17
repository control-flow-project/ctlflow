namespace CtlFlow.Execution.Execd.Domain.Storage;

public class AppStorageBinding
{
    internal string PlacementId { get; set; } = null!;
    internal string AppId { get; set; } = null!;
    internal string StorageId { get; set; } = null!;
    internal long CapacityBytes { get; set; }
}
