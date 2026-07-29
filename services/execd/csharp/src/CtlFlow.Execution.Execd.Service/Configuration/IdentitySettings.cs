namespace CtlFlow.Execution.Execd.Service.Configuration;

internal sealed record IdentitySettings(
    PrivateGrpcSettings Grpc,
    string WorkloadTokenFilePath,
    TimeSpan CallTimeout);
