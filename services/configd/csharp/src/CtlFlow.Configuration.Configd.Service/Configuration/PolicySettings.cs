namespace CtlFlow.Configuration.Configd.Service.Configuration;

internal sealed record PolicySettings(
    PrivateGrpcSettings Grpc,
    string WorkloadTokenFilePath,
    TimeSpan CallTimeout);
