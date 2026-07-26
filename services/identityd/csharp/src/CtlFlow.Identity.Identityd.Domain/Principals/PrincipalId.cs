namespace CtlFlow.Identity.Identityd.Domain.Principals;

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
        return ValueTask.FromResult(Create(value, stored: false));
    }

    public static PrincipalId FromStorage(string value) =>
        Create(value, stored: true);

    public override string ToString() => Value;

    private static PrincipalId Create(string value, bool stored)
    {
        var kind = value switch
        {
            var current when current.StartsWith(
                "user:",
                StringComparison.Ordinal) => PrincipalKind.Human,
            var current when current.StartsWith(
                "service:",
                StringComparison.Ordinal) => PrincipalKind.Service,
            var current when current.StartsWith(
                "agent:",
                StringComparison.Ordinal) => PrincipalKind.Virtual,
            _ => throw CreateException(stored)
        };
        var prefixLength = kind switch
        {
            PrincipalKind.Human => "user:".Length,
            PrincipalKind.Service => "service:".Length,
            PrincipalKind.Virtual => "agent:".Length,
            _ => throw new InvalidOperationException("Unknown principal kind")
        };
        if (value.Length > 256
            || value.Length <= prefixLength
            || !IsLowerAlphaNumeric(value[prefixLength]))
        {
            throw CreateException(stored);
        }

        foreach (var character in value.AsSpan(prefixLength + 1))
        {
            if (!IsLowerAlphaNumeric(character)
                && character is not '.' and not '_' and not '-')
            {
                throw CreateException(stored);
            }
        }

        return new PrincipalId(value, kind);
    }

    private static Exception CreateException(bool stored) =>
        stored
            ? new InvalidOperationException(
                "Stored principal ID is not canonical")
            : new ArgumentException("Principal ID is not canonical");

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
