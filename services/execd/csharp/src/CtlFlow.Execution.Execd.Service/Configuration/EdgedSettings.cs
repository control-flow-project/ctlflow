namespace CtlFlow.Execution.Execd.Service.Configuration;

internal sealed record EdgedSettings(
    string Image,
    Uri IdentityEndpoint,
    string IdentityServerName,
    string IdentityCertificateAuthority,
    TimeSpan IdentityCallTimeout,
    Uri TelemetryEndpoint);
