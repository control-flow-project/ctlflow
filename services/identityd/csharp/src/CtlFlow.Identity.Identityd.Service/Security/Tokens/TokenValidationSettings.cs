namespace CtlFlow.Identity.Identityd.Service.Security.Tokens;

internal sealed record TokenValidationSettings(
    string Issuer,
    string Audience,
    TimeSpan MaximumLifetime);
