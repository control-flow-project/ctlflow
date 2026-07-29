using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Configuration;

public abstract record ConfigTargetReference(Purpose Purpose)
{
    public sealed record Configuration(
        Purpose Purpose,
        ConfigurationId ConfigurationId,
        VersionId ConfigurationVersionId) : ConfigTargetReference(Purpose);

    public sealed record Secret(
        Purpose Purpose,
        SecretId SecretId,
        VersionId SecretVersionId) : ConfigTargetReference(Purpose);

    public DataKind Kind => this switch
    {
        Configuration => DataKind.Configuration,
        Secret => DataKind.Secret,
        _ => throw new InvalidOperationException("Config target is invalid")
    };

    public string TargetId => this switch
    {
        Configuration configuration => configuration.ConfigurationId.Value,
        Secret secret => secret.SecretId.Value,
        _ => throw new InvalidOperationException("Config target is invalid")
    };

    public string VersionId => this switch
    {
        Configuration configuration => configuration.ConfigurationVersionId.Value,
        Secret secret => secret.SecretVersionId.Value,
        _ => throw new InvalidOperationException("Config target is invalid")
    };
}

public sealed record ResolvedConfigTarget(
    ConfigTargetReference Target,
    ProjectionId? ProjectionId,
    Revision? ProjectionRevision);
