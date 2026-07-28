using static CtlFlow.Packages.Pkgd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Packages.Pkgd.Domain.Apps;

public sealed record AccountPrincipalId
{
    private AccountPrincipalId(string value) => Value = value;
    public string Value { get; }

    public static ValueTask<AccountPrincipalId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(Create(value, stored: false));
    }

    public static AccountPrincipalId FromStorage(string value) =>
        Create(value, stored: true);

    private static AccountPrincipalId Create(string value, bool stored)
    {
        var prefixLength = value.StartsWith("user:", StringComparison.Ordinal)
            ? "user:".Length
            : value.StartsWith("service:", StringComparison.Ordinal)
                ? "service:".Length
                : 0;
        if (prefixLength == 0
            || value.Length <= prefixLength
            || value.Length > 256
            || !IsLowerAlphaNumeric(value[prefixLength]))
        {
            throw CreateException("account principal ID", stored);
        }

        foreach (var character in value.AsSpan(prefixLength + 1))
        {
            if (!IsLowerAlphaNumeric(character)
                && character is not '.' and not '_' and not '-')
            {
                throw CreateException("account principal ID", stored);
            }
        }

        return new AccountPrincipalId(value);
    }
}
