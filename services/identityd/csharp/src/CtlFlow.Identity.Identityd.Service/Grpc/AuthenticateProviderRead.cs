using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.Identityd.Service.Security;
using CtlFlow.Identity.Identityd.Service.Security.Tokens;
using CtlFlow.Identity.Identityd.Service.Security.Workloads;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Security.Workloads.WorkloadAuthentication;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    private async ValueTask<IdentityRequestIdentity> AuthenticateProviderRead(
        ServerCallContext context,
        IReadOnlySet<KubernetesServiceAccountSubject> authdCallers,
        IdentityAdminOperation operation,
        DateTimeOffset currentTime)
    {
        var adminCallers = _settings.Administration.GetCallers(operation);
        var admitted = new HashSet<KubernetesServiceAccountSubject>(
            authdCallers);
        admitted.UnionWith(adminCallers);
        var identity = await AuthenticateIdentityRequest(
            context.RequestHeaders,
            _tokenAuthorities,
            admitted,
            requireInvocation: false,
            currentTime,
            context.CancellationToken);
        if (authdCallers.Contains(identity.ImmediateCaller))
        {
            if (identity.Invocation is not null)
            {
                throw new TokenValidationException();
            }

            return identity;
        }

        if (identity.Invocation is null)
        {
            throw new TokenValidationException();
        }

        return identity;
    }
}
