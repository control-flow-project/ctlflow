namespace CtlFlow.Identity.Identityd.Domain.Principals;

public sealed record VirtualPrincipalId
{
    private VirtualPrincipalId(PrincipalId principal)
    {
        Principal = principal;
    }

    public string Value => Principal.Value;

    public PrincipalId Principal { get; }

    public static async ValueTask<VirtualPrincipalId> Parse(
        string value,
        CancellationToken cancellation)
    {
        var principal = await PrincipalId.Parse(value, cancellation);
        if (principal.Kind != PrincipalKind.Virtual)
        {
            throw new ArgumentException(
                "Virtual principal ID is not virtual",
                nameof(value));
        }

        return new VirtualPrincipalId(principal);
    }

    public static VirtualPrincipalId FromStorage(string value)
    {
        var principal = PrincipalId.FromStorage(value);
        if (principal.Kind != PrincipalKind.Virtual)
        {
            throw new InvalidOperationException(
                "Stored virtual principal ID is not virtual");
        }

        return new VirtualPrincipalId(principal);
    }

    public override string ToString() => Value;
}
