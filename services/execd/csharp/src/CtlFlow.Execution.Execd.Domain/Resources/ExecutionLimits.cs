namespace CtlFlow.Execution.Execd.Domain.Resources;

public static class ExecutionLimits
{
    public const int MaximumPageSize = 100;
    public const int DefaultPageSize = 50;
    public const int MaximumReplicas = 100;
    public const long MaximumRunDurationSeconds = 604_800;
    public const int MaximumRunAttempts = 10;
    public const int MaximumCpuMillis = 1_000_000;
    public const long MaximumMemoryBytes = 1_099_511_627_776;
    public const long MaximumStorageBytes = 1_125_899_906_842_624;
    public const int MaximumStorageSlots = 64;
    public const int MaximumTargets = 256;
    public const int MaximumDependencies = 256;
    public const int MaximumParameters = 64;
    public const int MaximumInterfaces = 256;
    public const int MaximumConcurrentRuns = 10_000;
}
