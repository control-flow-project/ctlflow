using CtlFlow.Identity.Identityd.Service.Security.Tokens;

namespace CtlFlow.Identity.Identityd.Service.Security;

internal sealed class TokenAuthorities : IAsyncDisposable
{
    internal TokenAuthorities(
        TokenValidationSettings workloadSettings,
        VerificationKeys workloadKeys,
        TokenValidationSettings edgedWorkloadSettings,
        TokenValidationSettings invocationSettings,
        VerificationKeys invocationKeys)
    {
        WorkloadSettings = workloadSettings;
        WorkloadKeys = workloadKeys;
        EdgedWorkloadSettings = edgedWorkloadSettings;
        InvocationSettings = invocationSettings;
        InvocationKeys = invocationKeys;
    }

    internal TokenValidationSettings WorkloadSettings { get; }

    internal VerificationKeys WorkloadKeys { get; }

    internal TokenValidationSettings EdgedWorkloadSettings { get; }

    internal TokenValidationSettings InvocationSettings { get; }

    internal VerificationKeys InvocationKeys { get; }

    public async ValueTask DisposeAsync()
    {
        await WorkloadKeys.DisposeAsync();
        await InvocationKeys.DisposeAsync();
    }
}
