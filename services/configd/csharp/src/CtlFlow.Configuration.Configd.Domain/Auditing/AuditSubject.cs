namespace CtlFlow.Configuration.Configd.Domain.Auditing;

public sealed record AuditSubject
{
    private AuditSubject(string value) => Value = value;

    public string Value { get; }

    public static AuditSubject Parse(string value, int maximumLength)
    {
        if (value.Length is < 1
            || value.Length > maximumLength
            || value.Any(character =>
                char.IsWhiteSpace(character)
                || char.IsControl(character)))
        {
            throw new ArgumentException("Audit subject is invalid", nameof(value));
        }

        return new AuditSubject(value);
    }

    public static AuditSubject FromStorage(
        string value,
        int maximumLength)
    {
        try
        {
            return Parse(value, maximumLength);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored audit subject is invalid",
                exception);
        }
    }
}
