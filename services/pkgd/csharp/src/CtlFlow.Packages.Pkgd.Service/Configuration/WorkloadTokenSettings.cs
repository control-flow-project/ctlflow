using CtlFlow.Packages.Pkgd.Service.Security.Tokens;

namespace CtlFlow.Packages.Pkgd.Service.Configuration;

internal sealed record WorkloadTokenSettings(
    TokenValidationSettings Validation,
    string VerificationKeySetPath,
    TimeSpan KeyCacheLifetime);
