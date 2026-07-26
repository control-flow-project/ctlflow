namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

internal sealed record PolicySettings(
    PrivateGrpcSettings Grpc,
    string WorkloadTokenFilePath,
    TimeSpan CallTimeout);
