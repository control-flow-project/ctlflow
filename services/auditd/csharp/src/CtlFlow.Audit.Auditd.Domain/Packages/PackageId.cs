using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Packages;

public sealed record PackageId
{
    private PackageId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<PackageId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidatePackageId(value, nameof(value));
        return ValueTask.FromResult(new PackageId(value));
    }

    public static PackageId FromStorage(string value)
    {
        try
        {
            ValidatePackageId(value, nameof(value));
            return new PackageId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored Package ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
