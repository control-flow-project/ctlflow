namespace CtlFlow.Identity.Identityd.Domain.Auditing;

public sealed record AuditCaller
{
    private AuditCaller(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static AuditCaller Parse(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 253)
        {
            throw new ArgumentException(
                "Audit caller is invalid",
                nameof(value));
        }

        return new AuditCaller(value);
    }
}
