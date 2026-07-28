using CtlFlow.Configuration.Configd.Domain.Projections;
using Google.Protobuf.WellKnownTypes;
using V1 = CtlFlow.Configuration.V1;

namespace CtlFlow.Configuration.Configd.Service.Grpc.Responses;

internal static partial class ConfigdResponses
{
    internal static ValueTask<V1.Projection> CreateProjectionResponse(
        ProjectionMetadata value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new V1.Projection
        {
            ProjectionId = value.Id.Value,
            Target = CreateProjectionTargetResponse(value.Target),
            Binding = CreateConsumerBindingResponse(value.Binding),
            ProjectionRevision = checked((ulong)value.Revision.Value),
            CreatedAt = Timestamp.FromDateTimeOffset(value.CreatedAt.Value),
            UpdatedAt = Timestamp.FromDateTimeOffset(value.UpdatedAt.Value)
        });
    }

    private static V1.ProjectionTarget CreateProjectionTargetResponse(
        ProjectionTarget value) =>
        value switch
        {
            ProjectionTarget.Configuration configuration =>
                new V1.ProjectionTarget
                {
                    Configuration =
                        new V1.ConfigurationProjectionTarget
                        {
                            ConfigurationId =
                                configuration.ConfigurationId.Value,
                            ConfigurationVersionId =
                                configuration.VersionId.Value
                        }
                },
            ProjectionTarget.Secret secret => new V1.ProjectionTarget
            {
                Secret = new V1.SecretProjectionTarget
                {
                    SecretId = secret.SecretId.Value,
                    SecretVersionId = secret.VersionId.Value
                }
            },
            _ => throw new InvalidOperationException(
                "Projection target is invalid")
        };
}
