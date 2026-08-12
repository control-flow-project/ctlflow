using System.Text;

namespace CtlFlow.Identity.Identityd.Domain.IdentityLinks;

public sealed record ProviderSubject
{
    private const int MaximumLength = 512;

    private ProviderSubject(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<ProviderSubject> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!IsValid(value))
        {
            throw new ArgumentException(
                "Provider subject is invalid",
                nameof(value));
        }

        return ValueTask.FromResult(new ProviderSubject(value));
    }

    public static ProviderSubject FromStorage(string value)
    {
        if (!IsValid(value))
        {
            throw new InvalidOperationException(
                "Stored provider subject is invalid");
        }

        return new ProviderSubject(value);
    }

    private static bool IsValid(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return false;
        }

        var length = 0;
        foreach (var _ in value.EnumerateRunes())
        {
            if (++length > MaximumLength)
            {
                return false;
            }
        }

        return true;
    }
}
