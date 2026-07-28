namespace CtlFlow.Policy.Policyd.Service.Security.Tokens;

internal sealed class TokenValidationException : Exception
{
    internal TokenValidationException()
        : base("The token is invalid")
    {
    }
}
