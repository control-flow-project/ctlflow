using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Principals;

public enum PrincipalKind
{
    Human = 1,
    Service = 2,
    Virtual = 3
}

public sealed record PrincipalId
{
    private PrincipalId(string value, PrincipalKind kind)
    {
        Value = value;
        Kind = kind;
    }

    public string Value { get; }

    public PrincipalKind Kind { get; }

    public static ValueTask<PrincipalId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidatePrincipal(value, accountOnly: false);
        return ValueTask.FromResult(new PrincipalId(value, ReadKind(value)));
    }

    public static PrincipalId FromStorage(string value)
    {
        try
        {
            ValidatePrincipal(value, accountOnly: false);
            return new PrincipalId(value, ReadKind(value));
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored principal ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;

    private static PrincipalKind ReadKind(string value) =>
        value.AsSpan(0, value.IndexOf(':')) switch
        {
            var kind when kind.SequenceEqual("user") =>
                PrincipalKind.Human,
            var kind when kind.SequenceEqual("service") =>
                PrincipalKind.Service,
            var kind when kind.SequenceEqual("agent") =>
                PrincipalKind.Virtual,
            _ => throw new InvalidOperationException(
                "Validated principal kind is unknown")
        };
}
