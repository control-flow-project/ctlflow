namespace CtlFlow.Audit.Auditd.Domain.Principals;

public sealed record VirtualPrincipalId
{
    private VirtualPrincipalId(PrincipalId principal)
    {
        Principal = principal;
    }

    public PrincipalId Principal { get; }

    public string Value => Principal.Value;

    public static async ValueTask<VirtualPrincipalId> Parse(
        string value,
        CancellationToken cancellation)
    {
        var principal = await PrincipalId.Parse(value, cancellation);
        if (principal.Kind != PrincipalKind.Virtual)
        {
            throw new ArgumentException(
                "Virtual principal ID must name an agent",
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
                "Stored virtual principal ID is not an agent");
        }

        return new VirtualPrincipalId(principal);
    }

    public override string ToString() => Value;
}
