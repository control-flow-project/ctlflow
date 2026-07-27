namespace CtlFlow.Audit.Auditd.Service.Security.Tokens;

internal sealed class TokenKeySourceException : Exception
{
    internal TokenKeySourceException(Exception innerException)
        : base("The token verification-key source is unavailable", innerException)
    {
    }
}
