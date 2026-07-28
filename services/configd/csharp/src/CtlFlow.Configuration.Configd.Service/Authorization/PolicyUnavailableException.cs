namespace CtlFlow.Configuration.Configd.Service.Authorization;

internal sealed class PolicyUnavailableException : Exception
{
    internal PolicyUnavailableException(Exception innerException)
        : base("Required policy decision is unavailable", innerException)
    {
    }
}
