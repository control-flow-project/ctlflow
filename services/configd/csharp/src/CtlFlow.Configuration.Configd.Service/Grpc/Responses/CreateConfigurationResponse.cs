using CtlFlow.Configuration.Configd.Domain.Configurations;
using Google.Protobuf;
using Google.Protobuf.WellKnownTypes;
using V1 = CtlFlow.Configuration.V1;

namespace CtlFlow.Configuration.Configd.Service.Grpc.Responses;

internal static partial class ConfigdResponses
{
    internal static ValueTask<V1.PublishConfigurationResponse>
        CreateConfigurationResponse(
            ConfigurationMetadata configuration,
            ConfigurationVersionMetadata version,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new V1.PublishConfigurationResponse
        {
            Configuration = CreateConfigurationMetadata(configuration),
            Version = CreateConfigurationVersionMetadata(version)
        });
    }

    internal static V1.ConfigurationMetadata CreateConfigurationMetadata(
        ConfigurationMetadata value) =>
        new()
        {
            ConfigurationId = value.Id.Value,
            Binding = CreateConsumerBindingResponse(value.Binding),
            CurrentConfigurationVersionId = value.CurrentVersionId.Value,
            Revision = checked((ulong)value.Revision.Value),
            CreatedAt = Timestamp.FromDateTimeOffset(value.CreatedAt.Value),
            UpdatedAt = Timestamp.FromDateTimeOffset(value.UpdatedAt.Value)
        };

    internal static V1.ConfigurationVersionMetadata
        CreateConfigurationVersionMetadata(
            ConfigurationVersionMetadata value)
    {
        var digest = new byte[32];
        value.Content.Digest.CopyTo(digest);
        return new V1.ConfigurationVersionMetadata
        {
            ConfigurationVersionId = value.Id.Value,
            ConfigurationId = value.ConfigurationId.Value,
            ContentLength = checked((uint)value.Content.Length.Value),
            ContentSha256 = ByteString.CopyFrom(digest),
            CreatedAt = Timestamp.FromDateTimeOffset(value.CreatedAt.Value)
        };
    }
}
