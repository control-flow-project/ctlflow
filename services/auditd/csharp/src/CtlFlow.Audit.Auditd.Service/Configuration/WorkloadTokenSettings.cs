using CtlFlow.Audit.Auditd.Service.Security.Tokens;

namespace CtlFlow.Audit.Auditd.Service.Configuration;

internal sealed record WorkloadTokenSettings(
    TokenValidationSettings Validation,
    string VerificationKeySetPath,
    TimeSpan KeyCacheLifetime);
