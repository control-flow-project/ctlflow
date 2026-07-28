using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.V1;
using Google.Protobuf;
using Grpc.Core;
using static CtlFlow.Configuration.Configd.Service.Authorization.ConfigdAuthorization;
using static CtlFlow.Configuration.Configd.Service.Grpc.ConfigdGrpcErrors;
using static CtlFlow.Configuration.Configd.Service.Grpc.Requests.ConfigdRequests;
using static CtlFlow.Configuration.Configd.Service.Grpc.Responses.ConfigdResponses;
using ConfigurationDatabase =
    CtlFlow.Configuration.Configd.Db.Configurations.Configurations;

namespace CtlFlow.Configuration.Configd.Service.Grpc;

internal sealed partial class ConfigurationGrpcService
{
    public override async Task<ResolveConfigurationResponse>
        ResolveConfiguration(
            ResolveConfigurationRequest request,
            ServerCallContext context)
    {
        var identity = await AuthenticateResolveConfiguration(context);
        var binding = await CreateConsumerBinding(
            request.Binding,
            context.CancellationToken);
        var configurationId = ConfigurationId.Parse(
            request.ConfigurationId);
        var versionId = ConfigurationVersionId.Parse(
            request.ConfigurationVersionId);
        await AuthorizeCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            Authorization.ConfigdCapability.ReadConfiguration,
            binding,
            configurationId.Value,
            context.CancellationToken);
        var result = await ConfigurationDatabase.ResolveConfiguration(
            _configurationDatabase,
            configurationId,
            versionId,
            binding,
            context.CancellationToken);
        if (result is null)
        {
            throw CreateExpectedRpcException(StatusCode.NotFound);
        }

        using var contentLease = result.Content;
        var content = new byte[result.Content.Reference.Length.Value];
        result.Content.CopyTo(content);
        return new ResolveConfigurationResponse
        {
            Configuration = CreateConfigurationMetadata(
                result.Configuration),
            Version = CreateConfigurationVersionMetadata(result.Version),
            ContentJson = ByteString.CopyFrom(content)
        };
    }
}
