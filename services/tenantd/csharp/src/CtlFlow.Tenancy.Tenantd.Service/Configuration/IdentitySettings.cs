namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

internal sealed record IdentitySettings(
    PrivateGrpcSettings Grpc,
    string WorkloadTokenFilePath,
    TimeSpan CallTimeout);
