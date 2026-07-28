namespace CtlFlow.Policy.Policyd.Service.Configuration;

internal sealed record IdentitySettings(
    PrivateGrpcSettings Grpc,
    string WorkloadTokenFilePath,
    TimeSpan CallTimeout);
