namespace Fleetd.Domain;

public enum ExecutionKind { Host, Vm }
public readonly record struct ExecutionPlacement(ExecutionKind Kind, string? Image = null, string? Profile = null);
public sealed record VmImage(string Path, string Sha256);
public sealed record VmMount(string Path, bool ReadOnly);
public enum VmNetwork { Disabled, Outbound }
public sealed record VmProfile(int Cpus, int MemoryMiB, int MaximumMemoryMiB, VmNetwork Network, IReadOnlyList<VmMount> Mounts);
public sealed record ExecutionCatalog(int MemoryBudgetMiB, int HostReserveMiB,
    IReadOnlyDictionary<string, VmImage> Images, IReadOnlyDictionary<string, VmProfile> Profiles);
