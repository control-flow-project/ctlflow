using CtlFlow.Policy.Policyd.Domain.Identifiers;

namespace CtlFlow.Policy.Policyd.Domain.Subjects;

public readonly record struct SubjectId
{
    private SubjectId(string value) => Value = value;

    public string Value { get; }

    public static SubjectId FromPrincipal(PrincipalId value) =>
        new(value.Value);

    public static SubjectId FromGroup(GroupId value) =>
        new(value.Value);

    public static SubjectId FromStorage(
        SubjectKind kind,
        string value) =>
        kind switch
        {
            SubjectKind.Principal =>
                FromPrincipal(PrincipalId.FromStorage(value)),
            SubjectKind.Group => FromGroup(GroupId.FromStorage(value)),
            _ => throw new InvalidOperationException(
                "Stored policy subject kind is invalid")
        };

    public static SubjectId FromStorage(string value) =>
        value.Contains(':', StringComparison.Ordinal)
            ? FromPrincipal(PrincipalId.FromStorage(value))
            : FromGroup(GroupId.FromStorage(value));

    public override string ToString() => Value;
}
