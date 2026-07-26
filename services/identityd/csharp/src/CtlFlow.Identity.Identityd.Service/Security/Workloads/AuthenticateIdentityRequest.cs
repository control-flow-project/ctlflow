using CtlFlow.Identity.Identityd.Service.Security.Invocations;
using CtlFlow.Identity.Identityd.Service.Security.Tokens;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Security.Invocations.InvocationTokens;
using static CtlFlow.Identity.Identityd.Service.Security.Tokens.RequestTokens;
using static CtlFlow.Identity.Identityd.Service.Security.Workloads.WorkloadTokens;

namespace CtlFlow.Identity.Identityd.Service.Security.Workloads;

internal static partial class WorkloadAuthentication
{
    internal static async ValueTask<IdentityRequestIdentity>
        AuthenticateIdentityRequest(
            Metadata headers,
            TokenAuthorities authorities,
            IReadOnlySet<KubernetesServiceAccountSubject> admittedCallers,
            bool requireInvocation,
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
        if (!admittedCallers.Contains(caller))
        {
            throw new CallerNotAdmittedException();
        }

        var invocationToken = ReadBearerToken(
            headers,
            "ctlflow-invocation",
            required: requireInvocation);
        var invocation = invocationToken is null
            ? null
            : await ValidateInvocationToken(
                invocationToken,
                authorities.InvocationSettings,
                authorities.InvocationKeys,
                currentTime,
                cancellation);
        return new IdentityRequestIdentity(caller, invocation);
    }
}
