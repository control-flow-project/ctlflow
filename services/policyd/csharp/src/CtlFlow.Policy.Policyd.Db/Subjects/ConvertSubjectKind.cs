using CtlFlow.Policy.Policyd.Domain.Subjects;

namespace CtlFlow.Policy.Policyd.Db.Subjects;

internal static partial class SubjectKinds
{
    internal static int ToStorage(SubjectKind value) =>
        value switch
        {
            (SubjectKind)0 => 0,
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
