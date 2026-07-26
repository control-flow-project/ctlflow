using CtlFlow.Identity.Identityd.Service.Security.Tokens;

namespace CtlFlow.Identity.Identityd.Service.Security;

internal sealed class TokenAuthorities : IAsyncDisposable
{
    internal TokenAuthorities(
        TokenValidationSettings workloadSettings,
        VerificationKeys workloadKeys,
        TokenValidationSettings invocationSettings,
        VerificationKeys invocationKeys)
    {
        WorkloadSettings = workloadSettings;
        WorkloadKeys = workloadKeys;
        InvocationSettings = invocationSettings;
        InvocationKeys = invocationKeys;
    }

    internal TokenValidationSettings WorkloadSettings { get; }

    internal VerificationKeys WorkloadKeys { get; }

    internal TokenValidationSettings InvocationSettings { get; }

    internal VerificationKeys InvocationKeys { get; }

    public async ValueTask DisposeAsync()
    {
        await WorkloadKeys.DisposeAsync();
        await InvocationKeys.DisposeAsync();
    }
}
