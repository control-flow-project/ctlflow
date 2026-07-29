namespace CtlFlow.Egress.Egressd.Domain.Rules;

public abstract record RequestHeaderValue
{
    private RequestHeaderValue()
    {
    }

    public sealed record Literal(string Value) : RequestHeaderValue;

    public sealed record Secret(SecretName Name) : RequestHeaderValue;
}
