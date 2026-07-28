namespace CtlFlow.Policy.Policyd.Domain.Subjects;

internal static partial class SubjectKindCodes
{
    internal static int ToStorage(SubjectKind value) =>
        value switch
        {
            SubjectKind.Principal => 1,
            SubjectKind.Group => 2,
            _ => throw new InvalidOperationException("Unknown subject kind")
        };

    internal static SubjectKind FromStorage(int value) =>
        value switch
        {
            1 => SubjectKind.Principal,
            2 => SubjectKind.Group,
            _ => throw new InvalidOperationException(
                "Stored subject kind is invalid")
        };
}
