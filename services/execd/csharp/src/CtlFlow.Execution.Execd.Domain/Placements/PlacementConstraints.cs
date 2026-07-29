using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Placements;

public sealed record DependencyProvisionerSelection(
    DependencyType DependencyType,
    ProvisionerId ProvisionerId);

public sealed record PlacementConstraints
{
    private PlacementConstraints(
        bool admitContinuous,
        bool admitFinite,
        int maxReplicas,
        long maxRunDurationSeconds,
        int maxRunAttempts,
        int maxCpuMillis,
        long maxMemoryBytes,
        long maxStorageBytes,
        IReadOnlyList<DependencyProvisionerSelection> provisioners)
    {
        AdmitContinuous = admitContinuous;
        AdmitFinite = admitFinite;
        MaxReplicas = maxReplicas;
        MaxRunDurationSeconds = maxRunDurationSeconds;
        MaxRunAttempts = maxRunAttempts;
        MaxCpuMillis = maxCpuMillis;
        MaxMemoryBytes = maxMemoryBytes;
        MaxStorageBytes = maxStorageBytes;
        Provisioners = provisioners;
    }

    public bool AdmitContinuous { get; }
    public bool AdmitFinite { get; }
    public int MaxReplicas { get; }
    public long MaxRunDurationSeconds { get; }
    public int MaxRunAttempts { get; }
    public int MaxCpuMillis { get; }
    public long MaxMemoryBytes { get; }
    public long MaxStorageBytes { get; }
    public IReadOnlyList<DependencyProvisionerSelection> Provisioners { get; }

    public static PlacementConstraints Create(
        bool admitContinuous,
        bool admitFinite,
        uint maxReplicas,
        ulong maxRunDurationSeconds,
        uint maxRunAttempts,
        uint maxCpuMillis,
        ulong maxMemoryBytes,
        ulong maxStorageBytes,
        IEnumerable<DependencyProvisionerSelection> provisioners)
    {
        if (!admitContinuous && !admitFinite
            || maxReplicas is 0 or > ExecutionLimits.MaximumReplicas
            || maxRunDurationSeconds is 0 or > ExecutionLimits.MaximumRunDurationSeconds
            || maxRunAttempts is 0 or > ExecutionLimits.MaximumRunAttempts
            || maxCpuMillis is 0 or > ExecutionLimits.MaximumCpuMillis
            || maxMemoryBytes is 0 or > ExecutionLimits.MaximumMemoryBytes
            || maxStorageBytes is 0 or > ExecutionLimits.MaximumStorageBytes)
        {
            throw new ExecutionException(
                ExecutionError.InvalidArgument,
                "Placement constraints are invalid");
        }

        var selections = provisioners
            .OrderBy(item => item.DependencyType.Value, StringComparer.Ordinal)
            .ToArray();
        if (selections.Length > ExecutionLimits.MaximumDependencies
            || selections.Select(item => item.DependencyType).Distinct().Count()
                != selections.Length)
        {
            throw new ExecutionException(
                ExecutionError.InvalidArgument,
                "Dependency provisioner selections are invalid");
        }

        return new PlacementConstraints(
            admitContinuous,
            admitFinite,
            (int)maxReplicas,
            (long)maxRunDurationSeconds,
            (int)maxRunAttempts,
            (int)maxCpuMillis,
            (long)maxMemoryBytes,
            (long)maxStorageBytes,
            selections);
    }

    internal void EnsureNarrows(PlacementConstraints parent)
    {
        if (AdmitContinuous && !parent.AdmitContinuous
            || AdmitFinite && !parent.AdmitFinite
            || MaxReplicas > parent.MaxReplicas
            || MaxRunDurationSeconds > parent.MaxRunDurationSeconds
            || MaxRunAttempts > parent.MaxRunAttempts
            || MaxCpuMillis > parent.MaxCpuMillis
            || MaxMemoryBytes > parent.MaxMemoryBytes
            || MaxStorageBytes > parent.MaxStorageBytes)
        {
            throw new ExecutionException(
                ExecutionError.FailedPrecondition,
                "Placement constraints do not narrow the parent");
        }

        var parentSelections = parent.Provisioners.ToDictionary(
            item => item.DependencyType,
            item => item.ProvisionerId);
        foreach (var selection in Provisioners)
        {
            if (!parentSelections.TryGetValue(
                    selection.DependencyType,
                    out var parentProvisioner)
                || parentProvisioner != selection.ProvisionerId)
            {
                throw new ExecutionException(
                    ExecutionError.FailedPrecondition,
                    "Placement dependency selection does not narrow the parent");
            }
        }
    }
}
