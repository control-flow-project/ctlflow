namespace CtlFlow.Tenancy.Tenantd.Domain.Collections;

public abstract record ResourceMutationResult<T>
{
    private ResourceMutationResult()
    {
    }

    public sealed record Succeeded(T Resource) : ResourceMutationResult<T>;

    public sealed record NotFound : ResourceMutationResult<T>;

    public sealed record AlreadyExists(ResourceMutationFailure Failure)
        : ResourceMutationResult<T>;

    public sealed record FailedPrecondition(ResourceMutationFailure Failure)
        : ResourceMutationResult<T>;

    public sealed record Aborted(ResourceMutationFailure Failure)
        : ResourceMutationResult<T>;
}
