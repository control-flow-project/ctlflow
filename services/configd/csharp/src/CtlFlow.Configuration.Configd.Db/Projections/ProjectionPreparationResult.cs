namespace CtlFlow.Configuration.Configd.Db.Projections;

public abstract record ProjectionPreparationResult
{
    private ProjectionPreparationResult()
    {
    }

    public sealed record Ready(
        ProjectionApplicationLease Application) :
        ProjectionPreparationResult;

    public sealed record NotFound : ProjectionPreparationResult;

    public sealed record AlreadyExists : ProjectionPreparationResult;

    public sealed record FailedPrecondition : ProjectionPreparationResult;
}
