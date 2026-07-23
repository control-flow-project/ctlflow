using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;

namespace CtlFlow.Tenancy.Tenantd.Service.Security;

internal sealed class TokenAuthorities : IAsyncDisposable
{
    internal TokenAuthorities(
        TokenValidationSettings workloadSettings,
        TokenValidationSettings invocationSettings)
    {
        WorkloadSettings = workloadSettings;
        InvocationSettings = invocationSettings;
        WorkloadKeys = new VerificationKeys(
            workloadSettings.JwksPath,
            workloadSettings.KeyCacheLifetime);
        InvocationKeys = new VerificationKeys(
            invocationSettings.JwksPath,
            invocationSettings.KeyCacheLifetime);
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
