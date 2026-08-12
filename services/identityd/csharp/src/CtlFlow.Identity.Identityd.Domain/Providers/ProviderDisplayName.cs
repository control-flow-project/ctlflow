using System.Globalization;
using System.Text;

namespace CtlFlow.Identity.Identityd.Domain.Providers;

public sealed record ProviderDisplayName
{
    private const int MaximumLength = 128;

    private ProviderDisplayName(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<ProviderDisplayName> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var normalized = value.Trim();
        var length = 0;
        foreach (var rune in normalized.EnumerateRunes())
        {
            length++;
            if (Rune.GetUnicodeCategory(rune) == UnicodeCategory.Control)
            {
                throw new ArgumentException(
                    "Provider display name contains a control character",
                    nameof(value));
            }
        }

        if (length is < 1 or > MaximumLength)
        {
            throw new ArgumentException(
                $"Provider display name must contain 1 to {MaximumLength} characters",
                nameof(value));
        }

        return ValueTask.FromResult(new ProviderDisplayName(normalized));
    }

    public static ProviderDisplayName FromStorage(string value)
    {
        try
        {
            var parsed = Parse(value, CancellationToken.None).Result;
            if (!string.Equals(parsed.Value, value, StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    "Stored provider display name is not canonical",
                    nameof(value));
            }

            return parsed;
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored provider display name is invalid",
                exception);
        }
    }
}
