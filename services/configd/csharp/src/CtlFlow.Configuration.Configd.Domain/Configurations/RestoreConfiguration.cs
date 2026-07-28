namespace CtlFlow.Configuration.Configd.Domain.Configurations;

public static partial class Configurations
{
    public static ValueTask<ConfigurationResource> RestoreConfiguration(
        ConfigurationMetadata metadata,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (metadata.UpdatedAt.Value < metadata.CreatedAt.Value)
        {
            throw new InvalidOperationException(
                "Stored configuration timestamps are inconsistent");
        }

        return ValueTask.FromResult(new ConfigurationResource(
            metadata.Id,
            metadata.Binding,
            metadata.CurrentVersionId,
            metadata.Revision,
            metadata.CreatedAt,
            metadata.UpdatedAt));
    }
}
