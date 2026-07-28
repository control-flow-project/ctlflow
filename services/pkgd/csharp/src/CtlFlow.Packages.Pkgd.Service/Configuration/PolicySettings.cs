namespace CtlFlow.Packages.Pkgd.Service.Configuration;

internal sealed record PolicySettings(
    PrivateGrpcSettings Grpc,
    string WorkloadTokenFilePath,
    TimeSpan CallTimeout);
