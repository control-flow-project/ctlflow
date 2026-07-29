namespace CtlFlow.Execution.Execd.Domain.Auditing;

public sealed record AuditText
{
    private AuditText(string value) => Value = value;

    public string Value { get; }

    public static AuditText Parse(
        string value,
        int maximumLength,
        string label)
    {
        if (string.IsNullOrEmpty(value)
            || value.Length > maximumLength
            || value.Any(character => char.IsControl(character)))
        {
            throw new ArgumentException($"{label} is invalid", nameof(value));
        }

        return new AuditText(value);
    }
}
