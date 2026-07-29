namespace CtlFlow.Execution.Execd.Service.Configuration;

internal sealed record AuditSettings(
    PrivateGrpcSettings Grpc,
    string WorkloadTokenFilePath,
    TimeSpan CallTimeout);
