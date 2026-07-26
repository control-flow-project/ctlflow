namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

internal sealed record AuditSettings(
    PrivateGrpcSettings Grpc,
    string WorkloadTokenFilePath,
    TimeSpan CallTimeout);
