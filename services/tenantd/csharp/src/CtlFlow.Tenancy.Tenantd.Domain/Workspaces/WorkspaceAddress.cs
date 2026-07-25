namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public sealed record WorkspaceAddress
{
    private const int MaximumLength = 63;

    private WorkspaceAddress(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<WorkspaceAddress> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();

        if (!IsCanonical(value))
        {
            throw new ArgumentException("Workspace address is not canonical", nameof(value));
        }

        return ValueTask.FromResult(new WorkspaceAddress(value));
    }

    public static WorkspaceAddress FromStorage(string value)
    {
        if (!IsCanonical(value))
        {
            throw new InvalidOperationException("Stored Workspace address is not canonical");
        }

        return new WorkspaceAddress(value);
    }

    public override string ToString() => Value;

    private static bool IsCanonical(string value)
    {
        if (value.Length is < 1 or > MaximumLength
            || !IsLowerAlphaNumeric(value[0]))
        {
            return false;
        }

        foreach (var character in value.AsSpan(1))
        {
            if (!IsLowerAlphaNumeric(character)
                && character is not '-' and not '.' and not '_' and not '~')
            {
                return false;
            }
        }

        return value is not "." and not "..";
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
