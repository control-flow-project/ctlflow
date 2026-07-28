namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record OciArtifact(
    OciRepository Repository,
    Sha256Digest ManifestDigest);
