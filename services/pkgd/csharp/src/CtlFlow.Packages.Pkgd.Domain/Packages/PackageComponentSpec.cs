namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record PackageComponentSpec(
    ComponentId ComponentId,
    OciArtifact Artifact);
