namespace CtlFlow.Packages.Pkgd.Service.Configuration;

internal sealed record IdentitySettings(
    PrivateGrpcSettings Grpc,
    string WorkloadTokenFilePath,
    TimeSpan CallTimeout);
