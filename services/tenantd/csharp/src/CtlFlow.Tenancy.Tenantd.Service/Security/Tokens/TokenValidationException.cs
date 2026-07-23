namespace CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;

internal sealed class TokenValidationException : Exception
{
    internal TokenValidationException()
        : base("The token is invalid")
    {
    }
}
