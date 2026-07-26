namespace CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;

internal sealed record TokenValidationSettings(
    string Issuer,
    string Audience,
    TimeSpan MaximumLifetime);
