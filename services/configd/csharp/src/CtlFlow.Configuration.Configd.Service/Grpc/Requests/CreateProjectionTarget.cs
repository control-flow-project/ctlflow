using CtlFlow.Configuration.Configd.Domain.Identifiers;
using DomainProjectionTarget =
    CtlFlow.Configuration.Configd.Domain.Projections.ProjectionTarget;
using WireProjectionTarget = CtlFlow.Configuration.V1.ProjectionTarget;

namespace CtlFlow.Configuration.Configd.Service.Grpc.Requests;

internal static partial class ConfigdRequests
{
    internal static ValueTask<DomainProjectionTarget> CreateProjectionTarget(
        WireProjectionTarget? value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult<DomainProjectionTarget>(
            value?.TargetCase switch
        {
            WireProjectionTarget.TargetOneofCase.Configuration
                when value.Configuration is not null =>
                new DomainProjectionTarget.Configuration(
                    ConfigurationId.Parse(
                        value.Configuration.ConfigurationId),
                    ConfigurationVersionId.Parse(
                        value.Configuration.ConfigurationVersionId)),
            WireProjectionTarget.TargetOneofCase.Secret
                when value.Secret is not null =>
                new DomainProjectionTarget.Secret(
                    SecretId.Parse(value.Secret.SecretId),
                    SecretVersionId.Parse(value.Secret.SecretVersionId)),
            _ => throw new ArgumentException(
                "Exactly one projection target is required")
        });
    }
}
