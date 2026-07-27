using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Placements;

public sealed record PlacementId
{
    private PlacementId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<PlacementId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateCanonicalId(value, 64, nameof(value));
        return ValueTask.FromResult(new PlacementId(value));
    }

    public static PlacementId FromStorage(string value)
    {
        try
        {
            ValidateCanonicalId(value, 64, nameof(value));
            return new PlacementId(value);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored Placement ID is invalid",
                exception);
        }
    }

    public override string ToString() => Value;
}
