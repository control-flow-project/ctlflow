using CtlFlow.Tenancy.Tenantd.Domain.Text;

namespace CtlFlow.Tenancy.Tenantd.Domain.Requests;

public sealed record RequestActor
{
    private const int MaximumLength = 253;

    private RequestActor(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<RequestActor> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new RequestActor(
            BoundedText.Validate(value, MaximumLength, "Request actor")));
    }

    public static RequestActor FromStorage(string value) =>
        new(BoundedText.ValidateStored(
            value,
            MaximumLength,
            "request actor"));

    public override string ToString() => Value;
}
