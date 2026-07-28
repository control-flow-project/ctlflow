using CtlFlow.Configuration.Configd.Service.Security.Tokens;

namespace CtlFlow.Configuration.Configd.Service.Configuration;

internal sealed record WorkloadTokenSettings(
    TokenValidationSettings Validation,
    string VerificationKeySetPath,
    TimeSpan KeyCacheLifetime);
