namespace CtlFlow.Policy.Policyd.Service.Decisions;

internal sealed class ExecutionUnavailableException(Exception innerException)
    : Exception("Execd is unavailable", innerException);
