namespace CtlFlow.Configuration.Configd.Domain.Failures;

public enum ContractFailure
{
    NotFound = 1,
    AlreadyExists = 2,
    FailedPrecondition = 3,
    Aborted = 4,
    PermissionDenied = 5,
    Unavailable = 6
}
