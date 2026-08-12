using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.IdentityLinks;

public sealed record ExternalLinkId
{
    private ExternalLinkId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<ExternalLinkId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateExternalLinkId(value);
        return ValueTask.FromResult(new ExternalLinkId(value));
    }

    public static ExternalLinkId FromStorage(string value)
    {
        try
        {
            ValidateExternalLinkId(value);
            return new ExternalLinkId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored external-link ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
