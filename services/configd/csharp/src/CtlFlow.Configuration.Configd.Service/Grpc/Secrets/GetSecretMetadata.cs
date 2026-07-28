using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.V1;
using Grpc.Core;
using static CtlFlow.Configuration.Configd.Service.Authorization.ConfigdAuthorization;
using static CtlFlow.Configuration.Configd.Service.Grpc.ConfigdGrpcErrors;
using static CtlFlow.Configuration.Configd.Service.Grpc.Requests.ConfigdRequests;
using static CtlFlow.Configuration.Configd.Service.Grpc.Responses.ConfigdResponses;
using SecretDatabase = CtlFlow.Configuration.Configd.Db.Secrets.Secrets;

namespace CtlFlow.Configuration.Configd.Service.Grpc;

internal sealed partial class ConfigurationGrpcService
{
    public override async Task<GetSecretMetadataResponse> GetSecretMetadata(
        GetSecretMetadataRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateGetSecretMetadata(context);
        var binding = await CreateConsumerBinding(
            request.Binding,
            context.CancellationToken);
        var secretId = SecretId.Parse(request.SecretId);
        await AuthorizeCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            Authorization.ConfigdCapability.ReadSecretMetadata,
            binding,
            secretId.Value,
            context.CancellationToken);
        var result = await SecretDatabase.GetSecretMetadata(
            _configurationDatabase,
            secretId,
            binding,
            context.CancellationToken);
        return result is { } found
            ? new GetSecretMetadataResponse
            {
                Secret = CreateSecretMetadata(found.Secret),
                CurrentVersion =
                    CreateSecretVersionMetadata(found.Version)
            }
            : throw CreateExpectedRpcException(StatusCode.NotFound);
    }
}
