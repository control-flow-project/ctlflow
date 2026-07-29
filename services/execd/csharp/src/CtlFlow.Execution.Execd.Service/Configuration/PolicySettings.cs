namespace CtlFlow.Execution.Execd.Service.Configuration;

internal sealed record PolicySettings(
    PrivateGrpcSettings Grpc,
    string WorkloadTokenFilePath,
    TimeSpan CallTimeout);
