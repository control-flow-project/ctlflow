using CtlFlow.Tenancy.Tenantd.Domain.Identifiers;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public sealed record WorkspaceId
{
    private const int MaximumLength = 64;

    private WorkspaceId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<WorkspaceId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();

        if (!IsCanonical(value))
        {
            throw new ArgumentException("Workspace ID is not canonical", nameof(value));
        }

        return ValueTask.FromResult(new WorkspaceId(value));
    }

    public static WorkspaceId FromStorage(string value)
    {
        if (!IsCanonical(value))
        {
            throw new InvalidOperationException("Stored Workspace ID is not canonical");
        }

        return new WorkspaceId(value);
    }

    public static WorkspaceId Generate() =>
        new(OpaqueIdentifiers.Generate("wsp"));

    public override string ToString() => Value;

    private static bool IsCanonical(string value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > MaximumLength)
        {
            return false;
        }

        if (!IsLowerAlphaNumeric(value[0]))
        {
            return false;
        }

        for (var index = 1; index < value.Length; index++)
        {
            var character = value[index];
            if (!IsLowerAlphaNumeric(character) && character is not '_' and not '-')
            {
                return false;
            }
        }

        return true;
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
