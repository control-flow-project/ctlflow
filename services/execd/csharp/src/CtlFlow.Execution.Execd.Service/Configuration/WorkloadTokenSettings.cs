using CtlFlow.Execution.Execd.Service.Security.Tokens;

namespace CtlFlow.Execution.Execd.Service.Configuration;

internal sealed record WorkloadTokenSettings(
    TokenValidationSettings Validation,
    string VerificationKeySetPath,
    TimeSpan KeyCacheLifetime);
