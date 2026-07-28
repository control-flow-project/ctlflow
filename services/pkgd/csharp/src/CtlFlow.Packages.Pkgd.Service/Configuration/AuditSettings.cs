namespace CtlFlow.Packages.Pkgd.Service.Configuration;

internal sealed record AuditSettings(
    PrivateGrpcSettings Grpc,
    string WorkloadTokenFilePath,
    TimeSpan CallTimeout);
