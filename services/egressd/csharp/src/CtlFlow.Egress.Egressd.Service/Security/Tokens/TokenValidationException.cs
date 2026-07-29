namespace CtlFlow.Egress.Egressd.Service.Security.Tokens;

internal sealed class TokenValidationException : Exception
{
    internal TokenValidationException()
        : base("The workload token is invalid")
    {
    }
}
