using CtlFlow.Configuration.Configd.Domain.Identifiers;

namespace CtlFlow.Configuration.Configd.Domain.Projections;

public abstract record ProjectionTarget
{
    private ProjectionTarget()
    {
    }

    public abstract ProjectionDataKind Kind { get; }

    public sealed record Configuration(
        ConfigurationId ConfigurationId,
        ConfigurationVersionId VersionId) : ProjectionTarget
    {
        public override ProjectionDataKind Kind =>
            ProjectionDataKind.Configuration;
    }

    public sealed record Secret(
        SecretId SecretId,
        SecretVersionId VersionId) : ProjectionTarget
    {
        public override ProjectionDataKind Kind =>
            ProjectionDataKind.Secret;
    }
}
