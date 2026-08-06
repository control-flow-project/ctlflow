namespace CtlFlow.Execution.Execd.Domain.Workloads;

// One operation snapshotted from the admitted package component. It is
// Execd-internal and never appears in the caller-visible Workload projection.
public class WorkloadOperation
{
    public string WorkloadId { get; set; } = null!;
    public string Operation { get; set; } = null!;
}
