using System.Diagnostics;
using CtlFlow.Configuration.V1;
using Grpc.Core;
using static CtlFlow.Configuration.Configd.Service.Auditing.AuditDelivery;
using static CtlFlow.Configuration.Configd.Service.Authorization.ConfigdAuthorization;
using static CtlFlow.Configuration.Configd.Service.Grpc.Requests.ConfigdRequests;
using static CtlFlow.Configuration.Configd.Service.Kubernetes.KubernetesApis;
using SecretDatabase = CtlFlow.Configuration.Configd.Db.Secrets.Secrets;

namespace CtlFlow.Configuration.Configd.Service.Grpc;

internal sealed partial class ConfigurationGrpcService
{
    public override async Task<PublishSecretResponse> PublishSecret(
        PublishSecretRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticatePublishSecret(context);
        using var publication = await CreateSecretPublication(
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
            Authorization.ConfigdCapability.PublishSecret,
            publication.Draft.Binding,
            publication.Draft.Id.Value,
            context.CancellationToken);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        return await CompleteSecretMutation(
            await SecretDatabase.PublishSecret(
                _configurationDatabase,
                publication.Draft,
                publication.Material,
                _encryptionKeys,
                audit,
                context.CancellationToken),
            context.CancellationToken);
    }
}
