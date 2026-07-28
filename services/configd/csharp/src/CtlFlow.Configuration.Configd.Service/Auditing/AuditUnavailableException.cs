namespace CtlFlow.Configuration.Configd.Service.Auditing;

internal sealed class AuditUnavailableException : Exception
{
    internal AuditUnavailableException(Exception innerException)
        : base("Required audit delivery is unavailable", innerException)
    {
    }
}
