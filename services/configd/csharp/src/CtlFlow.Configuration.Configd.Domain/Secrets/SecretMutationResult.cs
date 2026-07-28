using CtlFlow.Configuration.Configd.Domain.Auditing;

namespace CtlFlow.Configuration.Configd.Domain.Secrets;

public abstract record SecretMutationResult
{
    private SecretMutationResult()
    {
    }

    public sealed record Current(
        SecretMetadata Secret,
        SecretVersionMetadata Version) : SecretMutationResult;

    public sealed record Changed(
        Secret Entity,
        SecretMetadata Secret,
        SecretVersionMetadata Version,
        PublicationAuditIntent Audit) : SecretMutationResult;

    public sealed record NotFound : SecretMutationResult;

    public sealed record AlreadyExists : SecretMutationResult;

    public sealed record FailedPrecondition : SecretMutationResult;

    public sealed record RevisionMismatch : SecretMutationResult;
}
