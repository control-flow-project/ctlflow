namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public sealed record WorkspaceAddressBindingId
{
    private const int MaximumLength = 64;

    private WorkspaceAddressBindingId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static WorkspaceAddressBindingId FromStorage(string value)
    {
        if (!IsCanonical(value))
        {
            throw new InvalidOperationException("Stored address-binding ID is invalid");
        }

        return new WorkspaceAddressBindingId(value);
    }

    public override string ToString() => Value;

    private static bool IsCanonical(string value)
    {
        if (string.IsNullOrEmpty(value)
            || value.Length > MaximumLength
            || !IsLowerAlphaNumeric(value[0]))
        {
            return false;
        }

        foreach (var character in value.AsSpan(1))
        {
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
