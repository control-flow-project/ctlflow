using CtlFlow.Configuration.Configd.Service.Security.Tokens;

namespace CtlFlow.Configuration.Configd.Service.Security;

internal sealed class TokenAuthorities : IAsyncDisposable
{
    internal TokenAuthorities(
        TokenValidationSettings workloadSettings,
        VerificationKeys workloadKeys,
        TokenValidationSettings invocationSettings,
        VerificationKeys invocationKeys)
    {
        WorkloadSettings = workloadSettings;
        InvocationSettings = invocationSettings;
        WorkloadKeys = workloadKeys;
        InvocationKeys = invocationKeys;
    }

    internal TokenValidationSettings WorkloadSettings { get; }

    internal TokenValidationSettings InvocationSettings { get; }

    internal VerificationKeys WorkloadKeys { get; }

    internal VerificationKeys InvocationKeys { get; }

    public async ValueTask DisposeAsync()
    {
        await WorkloadKeys.DisposeAsync();
        await InvocationKeys.DisposeAsync();
    }
}
