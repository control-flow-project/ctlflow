namespace CtlFlow.Identity.Identityd.Service.Security.Tokens;

internal sealed class TokenValidationException : Exception
{
    internal TokenValidationException()
        : base("The token is invalid")
    {
    }
}
