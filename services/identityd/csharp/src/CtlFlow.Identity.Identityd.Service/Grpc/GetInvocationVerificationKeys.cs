using CtlFlow.Identity.Identityd.Service.Security.Workloads;
using CtlFlow.Identity.V1;
using Google.Protobuf.WellKnownTypes;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Security.Workloads.WorkloadAuthentication;
using IdentityKeys = CtlFlow.Identity.Identityd.Db.Keys.VerificationKeys;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<GetInvocationVerificationKeysResponse>
        GetInvocationVerificationKeys(
            GetInvocationVerificationKeysRequest request,
            ServerCallContext context)
    {
        _ = request;
        // Verification keys are public material, so this bootstrap operation
        // admits any valid installation-issued bound workload token. It is the
        // only Identityd operation that does.
        await AuthenticateAnyWorkloadRequest(
            context.RequestHeaders,
            _tokenAuthorities,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        var keys = await IdentityKeys.GetInvocationVerificationKeys(
            _identityDatabase,
            context.CancellationToken);
        var response = new GetInvocationVerificationKeysResponse
        {
            ExpiresAt = Timestamp.FromDateTimeOffset(
                DateTimeOffset.UtcNow.Add(
                    _settings.InvocationKeyCacheLifetime))
        };
        response.Keys.Add(keys.Keys.Select(key =>
            new InvocationVerificationKey
            {
                KeyId = key.KeyId.Value,
                Algorithm = VerificationKeyAlgorithm.Rs256,
                ModulusBase64Url = key.Modulus.Value,
                ExponentBase64Url = key.Exponent.Value
            }));
        return response;
    }
}
