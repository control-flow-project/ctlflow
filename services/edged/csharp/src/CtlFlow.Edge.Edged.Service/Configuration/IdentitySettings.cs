namespace CtlFlow.Edge.Edged.Service.Configuration;

internal sealed record IdentitySettings(
    PrivateGrpcSettings Grpc,
    string WorkloadTokenFilePath,
    TimeSpan CallTimeout);
