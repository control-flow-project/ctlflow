using CtlFlow.Identity.Identityd.Domain.Invocations;
using CtlFlow.Identity.V1;
using Google.Protobuf.WellKnownTypes;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityGrpcErrors;
using static CtlFlow.Identity.Identityd.Service.Security.Signing.InvocationSigning;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    private async ValueTask<IssueInvocationResponse>
        CreateIssueInvocationResponse(
            InvocationIssueResult result,
            CancellationToken cancellation)
    {
        var issued = result switch
        {
            InvocationIssueResult.Issued value => value,
            InvocationIssueResult.Unauthenticated =>
                throw new Security.Tokens.TokenValidationException(),
            InvocationIssueResult.NotFound =>
                throw CreateExpectedRpcException(StatusCode.NotFound),
            _ => throw new InvalidOperationException(
                "Invocation issue result is invalid")
        };
        var jwt = await SignInvocation(
            _signingKey,
            _settings.InvocationTokens,
            issued.Claims,
            cancellation);
        return new IssueInvocationResponse
        {
            InvocationJwt = jwt.ReadForResponse(),
            ExpiresAt = Timestamp.FromDateTimeOffset(
                issued.Claims.ExpiresAt.Value)
        };
    }
}
