using CtlFlow.Policy.Policyd.Domain.Subjects;

namespace CtlFlow.Policy.Policyd.Domain.Decisions;

public static partial class PolicyDecisions
{
    public static bool IncludesSubject(
        PolicySubjects subjects,
        SubjectKind kind,
        SubjectId id) =>
        kind switch
        {
            SubjectKind.Principal =>
                subjects.Principal is { } principal
                && id == SubjectId.FromPrincipal(principal),
            SubjectKind.Group => subjects.Groups.Any(
                group => id == SubjectId.FromGroup(group)),
            _ => throw new InvalidOperationException(
                "Stored policy subject kind is invalid")
        };
}
