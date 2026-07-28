using CtlFlow.Configuration.Configd.Domain.Secrets;
using Grpc.Core;
using static CtlFlow.Configuration.Configd.Service.Auditing.AuditDelivery;
using static CtlFlow.Configuration.Configd.Service.Grpc.ConfigdGrpcErrors;
using static CtlFlow.Configuration.Configd.Service.Grpc.Responses.ConfigdResponses;

namespace CtlFlow.Configuration.Configd.Service.Grpc;

internal sealed partial class ConfigurationGrpcService
{
    private async Task<CtlFlow.Configuration.V1.PublishSecretResponse>
        CompleteSecretMutation(
            SecretMutationResult result,
            CancellationToken cancellation)
    {
        switch (result)
        {
            case SecretMutationResult.Changed changed:
                await RecordAudit(
                    _auditClient,
                    _settings.Audit,
                    _telemetry,
                    changed.Audit,
                    cancellation);
                return await CreateSecretResponse(
                    changed.Secret,
                    changed.Version,
                    cancellation);
            case SecretMutationResult.Current current:
                return await CreateSecretResponse(
                    current.Secret,
                    current.Version,
                    cancellation);
            case SecretMutationResult.NotFound:
                throw CreateExpectedRpcException(StatusCode.NotFound);
            case SecretMutationResult.AlreadyExists:
                throw CreateExpectedRpcException(StatusCode.AlreadyExists);
            case SecretMutationResult.FailedPrecondition:
                throw CreateExpectedRpcException(
                    StatusCode.FailedPrecondition);
            case SecretMutationResult.RevisionMismatch:
                throw CreateExpectedRpcException(StatusCode.Aborted);
            default:
                throw new InvalidOperationException(
                    "Secret mutation result is invalid");
        }
    }
}
