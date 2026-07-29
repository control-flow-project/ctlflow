namespace CtlFlow.Execution.Execd.Domain.Errors;

public enum ExecutionError
{
    InvalidArgument,
    NotFound,
    AlreadyExists,
    FailedPrecondition,
    Aborted,
    ResourceExhausted,
    Unavailable
}

public sealed class ExecutionException(
    ExecutionError error,
    string message) : Exception(message)
{
    public ExecutionError Error { get; } = error;
}
