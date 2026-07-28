namespace CtlFlow.Configuration.Configd.Service.Configuration;

internal sealed record AuditSettings(
    PrivateGrpcSettings Grpc,
    string WorkloadTokenFilePath,
    TimeSpan CallTimeout);
