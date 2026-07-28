using CtlFlow.Configuration.Configd.Domain.Configurations;
using Grpc.Core;
using static CtlFlow.Configuration.Configd.Service.Auditing.AuditDelivery;
using static CtlFlow.Configuration.Configd.Service.Grpc.ConfigdGrpcErrors;
using static CtlFlow.Configuration.Configd.Service.Grpc.Responses.ConfigdResponses;

namespace CtlFlow.Configuration.Configd.Service.Grpc;

internal sealed partial class ConfigurationGrpcService
{
    private async Task<CtlFlow.Configuration.V1.PublishConfigurationResponse>
        CompleteConfigurationMutation(
            ConfigurationMutationResult result,
            CancellationToken cancellation)
    {
        switch (result)
        {
            case ConfigurationMutationResult.Changed changed:
                await RecordAudit(
                    _auditClient,
                    _settings.Audit,
                    _telemetry,
                    changed.Audit,
                    cancellation);
                return await CreateConfigurationResponse(
                    changed.Configuration,
                    changed.Version,
                    cancellation);
            case ConfigurationMutationResult.Current current:
                return await CreateConfigurationResponse(
                    current.Configuration,
                    current.Version,
                    cancellation);
            case ConfigurationMutationResult.NotFound:
                throw CreateExpectedRpcException(StatusCode.NotFound);
            case ConfigurationMutationResult.AlreadyExists:
                throw CreateExpectedRpcException(StatusCode.AlreadyExists);
            case ConfigurationMutationResult.FailedPrecondition:
                throw CreateExpectedRpcException(
                    StatusCode.FailedPrecondition);
            case ConfigurationMutationResult.RevisionMismatch:
                throw CreateExpectedRpcException(StatusCode.Aborted);
            default:
                throw new InvalidOperationException(
                    "Configuration mutation result is invalid");
        }
    }
}
