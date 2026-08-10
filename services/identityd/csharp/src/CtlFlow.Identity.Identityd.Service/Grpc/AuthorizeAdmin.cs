using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.Identityd.Service.Security;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Authorization.IdentityAuthorization;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    private async ValueTask AuthorizeAdmin(
        IdentityRequestIdentity identity,
        IdentityAdminOperation operation,
        IdentityTarget target,
        string resourcePath,
        ServerCallContext context) =>
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
