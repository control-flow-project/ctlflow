namespace CtlFlow.Execution.Execd.Db.Workloads;

public sealed record WorkloadWriteContent(
    IReadOnlyList<DependencyOptionsContent> DependencyOptions);
