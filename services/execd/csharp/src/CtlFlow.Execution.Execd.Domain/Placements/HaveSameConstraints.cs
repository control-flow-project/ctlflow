namespace CtlFlow.Execution.Execd.Domain.Placements;

public static partial class Placements
{
    internal static bool HaveSameConstraints(
        PlacementConstraints left,
        PlacementConstraints right) =>
        left.AdmitContinuous == right.AdmitContinuous
        && left.AdmitFinite == right.AdmitFinite
        && left.MaxReplicas == right.MaxReplicas
        && left.MaxRunDurationSeconds == right.MaxRunDurationSeconds
        && left.MaxRunAttempts == right.MaxRunAttempts
        && left.MaxCpuMillis == right.MaxCpuMillis
        && left.MaxMemoryBytes == right.MaxMemoryBytes
        && left.MaxStorageBytes == right.MaxStorageBytes
        && left.Provisioners.SequenceEqual(right.Provisioners);
}
