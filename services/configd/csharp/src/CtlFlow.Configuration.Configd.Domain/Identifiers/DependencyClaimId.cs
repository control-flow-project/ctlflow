namespace CtlFlow.Configuration.Configd.Domain.Identifiers;

public sealed record DependencyClaimId
{
    private DependencyClaimId(string value) => Value = value;

    public string Value { get; }

    public static DependencyClaimId Parse(string value) =>
        new(Validate(value, stored: false));

    public static DependencyClaimId FromStorage(string value) =>
        new(Validate(value, stored: true));

    private static string Validate(string value, bool stored)
    {
        var valid = value.Length == 36
            && value.StartsWith("dpc-", StringComparison.Ordinal)
            && value.AsSpan(4).IndexOfAnyExcept(
                "0123456789abcdef".AsSpan()) < 0;
        if (!valid)
        {
            if (stored)
            {
                throw new InvalidOperationException(
                    "Stored dependency claim ID is not canonical");
            }

            throw new ArgumentException(
                "Dependency claim ID is not canonical",
                nameof(value));
        }

        return value;
    }
}
