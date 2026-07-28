using CtlFlow.Configuration.Configd.Domain.Configurations;

namespace CtlFlow.Configuration.Configd.Db.Content;

public sealed record ResolvedConfiguration(
    ConfigurationMetadata Configuration,
    ConfigurationVersionMetadata Version,
    ConfigurationContentLease Content);
