namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed class PackageLimitExceededException(string message)
    : Exception(message);
