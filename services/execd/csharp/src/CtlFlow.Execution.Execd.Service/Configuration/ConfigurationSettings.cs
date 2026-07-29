namespace CtlFlow.Execution.Execd.Service.Configuration;

internal sealed record ConfigurationSettings(
    PrivateGrpcSettings Grpc,
    string WorkloadTokenFilePath,
    TimeSpan CallTimeout);
