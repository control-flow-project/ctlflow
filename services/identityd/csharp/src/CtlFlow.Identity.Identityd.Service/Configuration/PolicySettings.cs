namespace CtlFlow.Identity.Identityd.Service.Configuration;

internal sealed record PolicySettings(
    PrivateGrpcSettings Grpc,
    string WorkloadTokenFilePath,
    TimeSpan CallTimeout);
