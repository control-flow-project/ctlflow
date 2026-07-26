using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;

namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

internal sealed record WorkloadTokenSettings(
    TokenValidationSettings Validation,
    string VerificationKeySetPath,
    TimeSpan KeyCacheLifetime);
