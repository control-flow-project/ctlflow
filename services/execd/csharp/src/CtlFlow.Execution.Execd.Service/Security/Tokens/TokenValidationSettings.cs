namespace CtlFlow.Execution.Execd.Service.Security.Tokens;

internal sealed record TokenValidationSettings(
    string Issuer,
    string Audience,
    TimeSpan MaximumLifetime);
