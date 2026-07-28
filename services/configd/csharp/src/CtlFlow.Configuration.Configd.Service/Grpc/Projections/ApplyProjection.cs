using System.Diagnostics;
using CtlFlow.Configuration.Configd.Db.Projections;
using CtlFlow.Configuration.V1;
using Grpc.Core;
using static CtlFlow.Configuration.Configd.Db.Projections.Projections;
using static CtlFlow.Configuration.Configd.Service.Auditing.AuditDelivery;
using static CtlFlow.Configuration.Configd.Service.Grpc.ConfigdGrpcErrors;
using static CtlFlow.Configuration.Configd.Service.Grpc.Requests.ConfigdRequests;
using static CtlFlow.Configuration.Configd.Service.Grpc.Responses.ConfigdResponses;
using static CtlFlow.Configuration.Configd.Service.Kubernetes.KubernetesApis;

namespace CtlFlow.Configuration.Configd.Service.Grpc;

internal sealed partial class ConfigurationGrpcService
{
    public override async Task<Projection> ApplyProjection(
        ApplyProjectionRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateApplyProjection(context);
        var target = await CreateProjectionTarget(
            request.Target,
            context.CancellationToken);
        var binding = await CreateConsumerBinding(
            request.Binding,
            context.CancellationToken);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        var preparation = await PrepareProjection(
            _configurationDatabase,
            target,
            binding,
            _encryptionKeys,
            audit,
            context.CancellationToken);
        if (preparation is not ProjectionPreparationResult.Ready ready)
        {
            throw preparation switch
            {
                ProjectionPreparationResult.NotFound =>
                    CreateExpectedRpcException(StatusCode.NotFound),
                ProjectionPreparationResult.AlreadyExists =>
                    CreateExpectedRpcException(StatusCode.AlreadyExists),
                ProjectionPreparationResult.FailedPrecondition =>
                    CreateExpectedRpcException(
                        StatusCode.FailedPrecondition),
                _ => new InvalidOperationException(
                    "Projection preparation result is invalid")
            };
        }

        await using var application = ready.Application;
        await ApplyProjectionObject(
            _kubernetes,
            application.Projection,
            application.Payload,
            context.CancellationToken);
        var completion = await CompleteProjection(
            application,
            context.CancellationToken);
        if (completion.Audit is not null)
        {
            await RecordAudit(
                _auditClient,
                _settings.Audit,
                _telemetry,
                completion.Audit,
                context.CancellationToken);
        }

        return await CreateProjectionResponse(
            completion.Projection,
            context.CancellationToken);
    }
}
