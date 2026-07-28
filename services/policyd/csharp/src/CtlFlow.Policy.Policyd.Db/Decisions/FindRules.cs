using CtlFlow.Policy.Policyd.Db.Providers;
using CtlFlow.Policy.Policyd.Db.Rules;
using CtlFlow.Policy.Policyd.Db.Subjects;
using CtlFlow.Policy.Policyd.Db.Targets;
using CtlFlow.Policy.Policyd.Domain.Decisions;
using CtlFlow.Policy.Policyd.Domain.Operations;
using CtlFlow.Policy.Policyd.Domain.Paths;
using CtlFlow.Policy.Policyd.Domain.Rules;
using CtlFlow.Policy.Policyd.Domain.Subjects;
using CtlFlow.Policy.Policyd.Domain.Targets;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Policy.Policyd.Domain.Decisions.PolicyDecisions;

namespace CtlFlow.Policy.Policyd.Db.Decisions;

public static partial class PolicyDecisions
{
    private const int MaximumCandidateRules = 4_096;

    public static async Task<IReadOnlyList<PolicyRule>> FindRules(
        PolicyDatabase policyDatabase,
        PolicyTarget target,
        PolicySubjects subjects,
        OperationToken operation,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = PolicyDbTelemetry.StartOperation("find_rules");
        await using var database =
            await policyDatabase.Contexts.CreateDbContextAsync(cancellation);
        var targetKind = TargetKinds.ToStorage(target.Kind);
        var tenantId = target.TenantId.Value;
        var workspaceId = target.WorkspaceId?.Value;
        var operationValue = operation.Value;
        var candidateLimit = MaximumCandidateRules + 1;
        var queryCancellation = cancellation;

        var directRows = await database.AccessGrants
            .AsNoTracking()
            .Where(grant =>
                EF.Property<int>(grant, "_targetKind") == targetKind
                && EF.Property<string>(grant, "_tenantId") == tenantId
                && EF.Property<string?>(
                    grant,
                    "_workspaceId") == workspaceId
                && EF.Property<string>(
                    grant,
                    "_operation") == operationValue)
            .Select(grant => new
            {
                SubjectKind = EF.Property<int>(grant, "_subjectKind"),
                SubjectId = EF.Property<string>(grant, "_subjectId"),
                BasePath = EF.Property<string>(grant, "_basePath"),
                MatchKind = EF.Property<int>(grant, "_matchKind")
            })
            .OrderBy(candidate => candidate.SubjectKind)
            .ThenBy(candidate => candidate.SubjectId)
            .ThenBy(candidate => candidate.BasePath)
            .ThenBy(candidate => candidate.MatchKind)
            .Take(candidateLimit)
            .ToListAsync(queryCancellation);

        var roleRows = await database.RoleRules
            .AsNoTracking()
            .Join(
                database.Roles.AsNoTracking(),
                rule => EF.Property<string>(rule, "_roleId"),
                role => EF.Property<string>(role, "_id"),
                (rule, role) => new { Rule = rule, Role = role })
            .Join(
                database.RoleBindings.AsNoTracking(),
                candidate => EF.Property<string>(
                    candidate.Role,
                    "_id"),
                binding => EF.Property<string>(binding, "_roleId"),
                (candidate, binding) => new
                {
                    candidate.Rule,
                    candidate.Role,
                    Binding = binding
                })
            .Where(candidate =>
                EF.Property<int>(
                    candidate.Role,
                    "_targetKind") == targetKind
                && EF.Property<string>(
                    candidate.Role,
                    "_tenantId") == tenantId
                && EF.Property<string?>(
                    candidate.Role,
                    "_workspaceId") == workspaceId
                && EF.Property<string>(
                    candidate.Rule,
                    "_operation") == operationValue)
            .Select(candidate => new
            {
                SubjectKind = EF.Property<int>(
                    candidate.Binding,
                    "_subjectKind"),
                SubjectId = EF.Property<string>(
                    candidate.Binding,
                    "_subjectId"),
                BasePath = EF.Property<string>(
                    candidate.Rule,
                    "_basePath"),
                MatchKind = EF.Property<int>(
                    candidate.Rule,
                    "_matchKind")
            })
            .Distinct()
            .OrderBy(candidate => candidate.SubjectKind)
            .ThenBy(candidate => candidate.SubjectId)
            .ThenBy(candidate => candidate.BasePath)
            .ThenBy(candidate => candidate.MatchKind)
            .Take(candidateLimit)
            .ToListAsync(queryCancellation);

        if (directRows.Count + roleRows.Count > MaximumCandidateRules)
        {
            throw new InvalidOperationException(
                "Policy candidate bound is exceeded");
        }

        return directRows
            .Where(row => IncludesSubject(
                subjects,
                SubjectKinds.FromStorage(row.SubjectKind),
                SubjectId.FromStorage(
                    SubjectKinds.FromStorage(row.SubjectKind),
                    row.SubjectId)))
            .Select(row => new PolicyRule(
                ResourcePath.FromStorage(row.BasePath),
                RuleMatchKinds.FromStorage(row.MatchKind)))
            .Concat(roleRows
                .Where(row => IncludesSubject(
                    subjects,
                    SubjectKinds.FromStorage(row.SubjectKind),
                    SubjectId.FromStorage(
                        SubjectKinds.FromStorage(row.SubjectKind),
                        row.SubjectId)))
                .Select(row => new PolicyRule(
                    ResourcePath.FromStorage(row.BasePath),
                    RuleMatchKinds.FromStorage(row.MatchKind))))
            .ToArray();
    }
}
