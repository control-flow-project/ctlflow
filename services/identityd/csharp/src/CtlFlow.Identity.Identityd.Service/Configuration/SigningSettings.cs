using CtlFlow.Identity.Identityd.Domain.Invocations;
using CtlFlow.Identity.Identityd.Domain.Keys;

namespace CtlFlow.Identity.Identityd.Service.Configuration;

internal sealed record SigningSettings(
    VerificationKeyId KeyId,
    string PrivateKeyPath,
    InvocationLifetime Lifetime);
