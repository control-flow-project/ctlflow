using CtlFlow.Policy.Policyd.Service.Security.Tokens;

namespace CtlFlow.Policy.Policyd.Service.Configuration;

internal sealed record WorkloadTokenSettings(
    TokenValidationSettings Validation,
    string VerificationKeySetPath,
    TimeSpan KeyCacheLifetime);
