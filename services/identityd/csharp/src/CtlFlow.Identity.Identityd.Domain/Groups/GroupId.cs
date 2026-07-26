using static CtlFlow.Identity.Identityd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Identity.Identityd.Domain.Groups;

public sealed record GroupId
{
    private GroupId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<GroupId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(
            new GroupId(ValidateIdentifier(value, "Group ID")));
    }

    public static GroupId FromStorage(string value) =>
        new(ValidateStoredIdentifier(value, "Group ID"));

    public override string ToString() => Value;
}
