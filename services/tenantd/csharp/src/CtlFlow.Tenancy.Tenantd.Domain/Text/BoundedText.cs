namespace CtlFlow.Tenancy.Tenantd.Domain.Text;

internal static class BoundedText
{
    internal static string Validate(
        string value,
        int maximumLength,
        string name)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > maximumLength)
        {
            throw new ArgumentException($"{name} is invalid", nameof(value));
        }

        return value;
    }

    internal static string ValidateStored(
        string value,
        int maximumLength,
        string name)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > maximumLength)
        {
            throw new InvalidOperationException($"Stored {name} is invalid");
        }

        return value;
    }
}
