using System.Diagnostics;
using CtlFlow.Configuration.V1;
using Grpc.Core;
using static CtlFlow.Configuration.Configd.Service.Auditing.AuditDelivery;
using static CtlFlow.Configuration.Configd.Service.Authorization.ConfigdAuthorization;
using static CtlFlow.Configuration.Configd.Service.Grpc.Requests.ConfigdRequests;
using static CtlFlow.Configuration.Configd.Service.Kubernetes.KubernetesApis;
using ConfigurationDatabase =
    CtlFlow.Configuration.Configd.Db.Configurations.Configurations;

namespace CtlFlow.Configuration.Configd.Service.Grpc;

internal sealed partial class ConfigurationGrpcService
{
    public override async Task<PublishConfigurationResponse>
        PublishConfiguration(
            PublishConfigurationRequest request,
            ServerCallContext context)
    {
        var identity = await AuthenticatePublishConfiguration(context);
        using var publication = await CreateConfigurationPublication(
            request,
            context.CancellationToken);
        await ValidatePublicationAdmission(
            _kubernetes,
            identity,
            publication.Draft.DependencyClaim,
            publication.Draft.Binding,
            context.CancellationToken);
        await AuthorizeCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            Authorization.ConfigdCapability.PublishConfiguration,
            publication.Draft.Binding,
            publication.Draft.Id.Value,
            context.CancellationToken);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        return await CompleteConfigurationMutation(
            await ConfigurationDatabase.PublishConfiguration(
                _configurationDatabase,
                publication.Draft,
                publication.Content,
                audit,
                context.CancellationToken),
            context.CancellationToken);
    }
}
