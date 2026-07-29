namespace CtlFlow.Execution.Execd.Service.Configuration;

internal sealed record PackageSettings(
    PrivateGrpcSettings Grpc,
    string WorkloadTokenFilePath,
    TimeSpan CallTimeout);
