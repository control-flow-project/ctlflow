namespace CtlFlow.Configuration.Configd.Domain.Configurations;

public static partial class Configurations
{
    public static ValueTask<ConfigurationMetadata> DescribeConfiguration(
        ConfigurationResource configuration,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new ConfigurationMetadata(
            configuration.Id,
            configuration.Binding,
            configuration.CurrentVersionId,
            configuration.Revision,
            configuration.CreatedAt,
            configuration.UpdatedAt));
    }
}
