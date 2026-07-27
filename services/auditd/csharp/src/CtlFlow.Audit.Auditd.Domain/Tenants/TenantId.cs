using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Tenants;

public sealed record TenantId
{
    private TenantId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<TenantId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateCanonicalId(value, 64, nameof(value));
        return ValueTask.FromResult(new TenantId(value));
    }

    public static TenantId FromStorage(string value) =>
        CreateFromStorage(value);

    public override string ToString() => Value;

    private static TenantId CreateFromStorage(string value)
    {
        try
        {
            ValidateCanonicalId(value, 64, nameof(value));
            return new TenantId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored Tenant ID is invalid",
                exception);
        }
    }
}
