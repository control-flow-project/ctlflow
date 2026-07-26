namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public sealed record AuditText
{
    private AuditText(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static AuditText Parse(string value, int maximumLength, string label)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > maximumLength)
        {
            throw new ArgumentException($"{label} is invalid", nameof(value));
        }

        return new AuditText(value);
    }

    public static AuditText FromStorage(
        string value,
        int maximumLength,
        string label)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > maximumLength)
        {
            throw new InvalidOperationException($"Stored {label} is invalid");
        }

        return new AuditText(value);
    }

    public override string ToString() => Value;
}
