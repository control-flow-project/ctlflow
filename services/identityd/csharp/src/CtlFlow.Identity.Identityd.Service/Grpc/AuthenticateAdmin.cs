using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.Identityd.Service.Security;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Security.Workloads.WorkloadAuthentication;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    private async ValueTask<IdentityRequestIdentity> AuthenticateAdmin(
        ServerCallContext context,
        IdentityAdminOperation operation,
        DateTimeOffset currentTime) =>
        await AuthenticateIdentityRequest(
            context.RequestHeaders,
            _tokenAuthorities,
            _settings.Administration.GetCallers(operation),
            requireInvocation: true,
            currentTime,
            context.CancellationToken);
}
