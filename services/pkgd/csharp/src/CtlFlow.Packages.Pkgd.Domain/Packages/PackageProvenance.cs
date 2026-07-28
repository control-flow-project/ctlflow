namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record PackageProvenance(
    SourceUri SourceUri,
    Sha256Digest SourceDigest);
