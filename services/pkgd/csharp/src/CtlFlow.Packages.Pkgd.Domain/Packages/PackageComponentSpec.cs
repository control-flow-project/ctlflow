namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record PackageComponentSpec(
    ComponentId ComponentId,
    OciArtifact Artifact,
    IReadOnlyList<DeclaredOperation> DeclaredOperations)
{
    // Value equality over the canonically ordered operation list, so an
    // identical retry compares equal to the retained declaration.
    public bool Equals(PackageComponentSpec? other) =>
        other is not null
        && ComponentId == other.ComponentId
        && Artifact == other.Artifact
        && DeclaredOperations.SequenceEqual(other.DeclaredOperations);

    public override int GetHashCode() =>
        HashCode.Combine(
            ComponentId,
            Artifact,
            DeclaredOperations.Count);
}
