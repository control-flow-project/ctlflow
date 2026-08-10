using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.Identityd.Service.Security;
using CtlFlow.Identity.Identityd.Service.Security.Workloads;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Authorization.IdentityAuthorization;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    private async ValueTask AuthorizeProviderRead(
        IdentityRequestIdentity identity,
        IReadOnlySet<KubernetesServiceAccountSubject> authdCallers,
        IdentityAdminOperation operation,
        IdentityTarget target,
        string resourcePath,
        ServerCallContext context)
    {
        if (authdCallers.Contains(identity.ImmediateCaller))
        {
            return;
        }

        await AuthorizeIdentityCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            operation,
            target,
            resourcePath,
            context.CancellationToken);
    }
}
