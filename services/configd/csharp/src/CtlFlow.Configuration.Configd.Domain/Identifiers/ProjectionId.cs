namespace CtlFlow.Configuration.Configd.Domain.Identifiers;

public sealed record ProjectionId
{
    private ProjectionId(string value) => Value = value;

    public string Value { get; }

    internal static ProjectionId FromDigest(string digest) =>
        new($"prj_{digest}");

    public static ProjectionId FromStorage(string value)
    {
        var valid = value.Length == 56
            && value.StartsWith("prj_", StringComparison.Ordinal)
            && value.AsSpan(4).IndexOfAnyExcept(
                "abcdefghijklmnopqrstuvwxyz234567".AsSpan()) < 0;
        return valid
            ? new ProjectionId(value)
            : throw new InvalidOperationException(
                "Stored projection ID is not canonical");
    }
}
