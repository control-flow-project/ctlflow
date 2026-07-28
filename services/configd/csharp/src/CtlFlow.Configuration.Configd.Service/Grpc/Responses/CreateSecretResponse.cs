using CtlFlow.Configuration.Configd.Domain.Secrets;
using Google.Protobuf.WellKnownTypes;
using V1 = CtlFlow.Configuration.V1;

namespace CtlFlow.Configuration.Configd.Service.Grpc.Responses;

internal static partial class ConfigdResponses
{
    internal static ValueTask<V1.PublishSecretResponse> CreateSecretResponse(
        SecretMetadata secret,
        SecretVersionMetadata version,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new V1.PublishSecretResponse
        {
            Secret = CreateSecretMetadata(secret),
            Version = CreateSecretVersionMetadata(version)
        });
    }

    internal static V1.SecretMetadata CreateSecretMetadata(
        SecretMetadata value) =>
        new()
        {
            SecretId = value.Id.Value,
            Binding = CreateConsumerBindingResponse(value.Binding),
            CurrentSecretVersionId = value.CurrentVersionId.Value,
            Revision = checked((ulong)value.Revision.Value),
            CreatedAt = Timestamp.FromDateTimeOffset(value.CreatedAt.Value),
            UpdatedAt = Timestamp.FromDateTimeOffset(value.UpdatedAt.Value)
        };

    internal static V1.SecretVersionMetadata CreateSecretVersionMetadata(
        SecretVersionMetadata value) =>
        new()
        {
            SecretVersionId = value.Id.Value,
            SecretId = value.SecretId.Value,
            CreatedAt = Timestamp.FromDateTimeOffset(value.CreatedAt.Value)
        };
}
