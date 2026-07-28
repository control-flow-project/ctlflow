using CtlFlow.Configuration.Configd.Domain.Auditing;

namespace CtlFlow.Configuration.Configd.Domain.Configurations;

public abstract record ConfigurationMutationResult
{
    private ConfigurationMutationResult()
    {
    }

    public sealed record Current(
        ConfigurationMetadata Configuration,
        ConfigurationVersionMetadata Version) : ConfigurationMutationResult;

    public sealed record Changed(
        ConfigurationResource Entity,
        ConfigurationMetadata Configuration,
        ConfigurationVersionMetadata Version,
        PublicationAuditIntent Audit) : ConfigurationMutationResult;

    public sealed record NotFound : ConfigurationMutationResult;

    public sealed record AlreadyExists : ConfigurationMutationResult;

    public sealed record FailedPrecondition : ConfigurationMutationResult;

    public sealed record RevisionMismatch : ConfigurationMutationResult;
}
