using CtlFlow.Identity.Identityd.Service.Security.Tokens;

namespace CtlFlow.Identity.Identityd.Service.Configuration;

internal sealed record WorkloadTokenSettings(
    TokenValidationSettings Validation,
    string VerificationKeySetPath,
    TimeSpan KeyCacheLifetime);
