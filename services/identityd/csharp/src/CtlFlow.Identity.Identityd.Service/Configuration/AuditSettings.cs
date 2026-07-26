namespace CtlFlow.Identity.Identityd.Service.Configuration;

internal sealed record AuditSettings(
    PrivateGrpcSettings Grpc,
    string WorkloadTokenFilePath,
    TimeSpan CallTimeout);
