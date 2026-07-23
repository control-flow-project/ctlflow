namespace CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;

internal sealed record TokenValidationSettings(
    string Issuer,
    string Audience,
    string JwksPath,
    TimeSpan MaximumLifetime,
    TimeSpan KeyCacheLifetime);
