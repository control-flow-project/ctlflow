namespace CtlFlow.Tenancy.Tenantd.Domain.Collections;

public sealed record PageToken
{
    private const int MaximumLength = 128;

    private PageToken(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<PageToken?> ParseOptional(
        string? value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (string.IsNullOrEmpty(value))
        {
            return ValueTask.FromResult<PageToken?>(null);
        }

        if (value.Length > MaximumLength
            || value.Any(character =>
                character is not (
                    >= 'a' and <= 'z'
                    or >= '0' and <= '9'
                    or '_'
                    or '-')))
        {
            throw new ArgumentException(
                "Page token is not canonical",
                nameof(value));
        }

        return ValueTask.FromResult<PageToken?>(new PageToken(value));
    }

    public static PageToken FromStorage(string value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > MaximumLength)
        {
            throw new InvalidOperationException(
                "Stored page token is invalid");
        }

        return new PageToken(value);
    }
}
