using Grpc.Core;
using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;
using CtlFlow.Tenancy.Tenantd.Service.Security.Workloads;
using static CtlFlow.Tenancy.Tenantd.Service.Security.Invocations.InvocationTokens;
using static CtlFlow.Tenancy.Tenantd.Service.Security.Tokens.RequestTokens;
using static CtlFlow.Tenancy.Tenantd.Service.Security.Workloads.WorkloadTokens;

namespace CtlFlow.Tenancy.Tenantd.Service.Security;

internal static partial class TenantRequestAuthentication
{
    internal static async ValueTask<TenantRequestIdentity> AuthenticateTenantRequest(
        Metadata headers,
        TokenAuthorities authorities,
        IReadOnlySet<KubernetesServiceAccountSubject> allowedCallers,
        DateTimeOffset currentTime,
        CancellationToken cancellation)
    {
        var workloadToken = ReadBearerToken(
            headers,
            "authorization",
            required: true)
            ?? throw new TokenValidationException();
        var caller = await ValidateWorkloadToken(
            workloadToken,
            authorities.WorkloadSettings,
            authorities.WorkloadKeys,
            currentTime,
            cancellation);

        if (!allowedCallers.Contains(caller))
        {
            throw new CallerNotAdmittedException();
        }

        var invocationToken = ReadBearerToken(
            headers,
            "ctlflow-invocation",
            required: false);
        var invocation = invocationToken is null
            ? null
            : await ValidateInvocationToken(
                invocationToken,
                authorities.InvocationSettings,
                authorities.InvocationKeys,
                currentTime,
                cancellation);

        return new TenantRequestIdentity(caller, invocation);
    }
}
