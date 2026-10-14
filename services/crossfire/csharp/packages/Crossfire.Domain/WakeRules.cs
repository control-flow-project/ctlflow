using System.Text;
using Crossfire.Kernel;

namespace Crossfire.Domain;

public abstract record WakeSchedule;
public sealed record IntervalSchedule(long Seconds) : WakeSchedule;
public sealed record CronSchedule(string Expression, string TimeZone) : WakeSchedule;
public sealed record WakeRule(string Id, string OwnerId, string ConfiguredById, string Name, string Message, WakeSchedule Schedule, bool Enabled, long Revision, long CreatedAt, long UpdatedAt);
public sealed record WakeAssignment(string RuleId, string AgentId, long NextDueAt, long? LastDeliveredAt);
public sealed record WakeRuleInput(string Name, string Message, WakeSchedule Schedule, bool Enabled, IReadOnlyList<string> AgentIds);
public sealed record WakeRuleSummary(WakeRule Rule, PrincipalSummary Owner, long AgentCount, long? NextDueAt, long? LastDeliveredAt);
public sealed record WakeAssignedAgent(PrincipalSummary Identity, WakeAssignment Assignment);
public sealed record WakeRuleDetails(WakeRuleSummary Summary, IReadOnlyList<WakeAssignedAgent> Agents);
public sealed record WakeRulePorts(DiscoveryPorts Discovery, UnitOfWork Transaction, Func<WakeSchedule, long, Result<long>> Next,
    Func<string, Result<WakeRule?>> Find, Func<WakeRule, bool, Result<Unit>> Save, Func<string, Result<Unit>> Remove,
    Func<string?, string, int, int, Result<Page<WakeRule>>> Page, Func<IReadOnlyList<string>, Result<IReadOnlyList<WakeAssignment>>> Assignments,
    Func<WakeAssignment, Result<Unit>> SaveAssignment, Func<string, string, Result<Unit>> RemoveAssignment,
    Func<string, Result<Unit>> CancelPending, Func<AuditIntent, Result<Unit>> Audit);

public static class WakeRules
{
    public static Result<WakeRule> Authorized(WakeRulePorts ports, Actor actor, string id, bool write = false)
    {
        if (actor.Kind != "human") return Results.Fail<WakeRule>("forbidden", "Only members manage Wake-ups");
        var active = Authorization.ActiveActor(ports.Discovery.Authorization, actor); if (!active.IsSuccess) return Result<WakeRule>.Fail(active.Error);
        var rule = ports.Find(id); if (!rule.IsSuccess) return Result<WakeRule>.Fail(rule.Error);
        if (rule.Value is null) return Results.Fail<WakeRule>("missing", "Wake-up not found");
        var permissions = ports.Discovery.Authorization.Permissions(actor.PrincipalId); if (!permissions.IsSuccess) return Result<WakeRule>.Fail(permissions.Error);
        var action = write ? "manage" : "read";
        return permissions.Value.Contains("wake-rule." + action + ".any", StringComparer.Ordinal) || rule.Value.OwnerId == actor.PrincipalId && permissions.Value.Contains("wake-rule." + action + ".owned", StringComparer.Ordinal)
            ? Result<WakeRule>.Success(rule.Value) : Results.Fail<WakeRule>("missing", "Wake-up not found");
    }

    public static Result<WakeRuleDetails> Read(WakeRulePorts ports, Actor actor, string id)
    {
        var rule = Authorized(ports, actor, id); if (!rule.IsSuccess) return Result<WakeRuleDetails>.Fail(rule.Error);
        var summary = Summaries(ports, [rule.Value]); if (!summary.IsSuccess) return Result<WakeRuleDetails>.Fail(summary.Error);
        var assigned = ports.Assignments([id]); if (!assigned.IsSuccess) return Result<WakeRuleDetails>.Fail(assigned.Error);
        var agents = ports.Discovery.Selected(assigned.Value.Select(value => value.AgentId).ToArray()); if (!agents.IsSuccess) return Result<WakeRuleDetails>.Fail(agents.Error);
        var byId = agents.Value.ToDictionary(value => value.PrincipalId, StringComparer.Ordinal);
        if (assigned.Value.Any(value => !byId.ContainsKey(value.AgentId))) return Results.Fail<WakeRuleDetails>("unavailable", "Wake-up agent is missing");
        return Result<WakeRuleDetails>.Success(new(summary.Value[0], assigned.Value.Select(value => new WakeAssignedAgent(byId[value.AgentId], value)).ToArray()));
    }

    public static Result<Page<WakeRuleSummary>> List(WakeRulePorts ports, Actor actor, string? ownerId, string search, int page, int size)
    {
        if (actor.Kind != "human") return Results.Fail<Page<WakeRuleSummary>>("forbidden", "Only members can list Wake-ups");
        var scope = OwnerScopes.Read(ports.Discovery.Authorization, actor, "wake-rule.read", ownerId); if (!scope.IsSuccess) return Result<Page<WakeRuleSummary>>.Fail(scope.Error);
        var rules = ports.Page(scope.Value, search, page, size); if (!rules.IsSuccess) return Result<Page<WakeRuleSummary>>.Fail(rules.Error);
        return Summaries(ports, rules.Value.Items).Map(values => new Page<WakeRuleSummary>(values, page, size, rules.Value.TotalItems));
    }

    private static Result<IReadOnlyList<WakeRuleSummary>> Summaries(WakeRulePorts ports, IReadOnlyList<WakeRule> rules)
    {
        var owners = ports.Discovery.Selected(rules.Select(value => value.OwnerId).Distinct(StringComparer.Ordinal).ToArray()); if (!owners.IsSuccess) return Result<IReadOnlyList<WakeRuleSummary>>.Fail(owners.Error);
        var assigned = ports.Assignments(rules.Select(value => value.Id).ToArray()); if (!assigned.IsSuccess) return Result<IReadOnlyList<WakeRuleSummary>>.Fail(assigned.Error);
        var byOwner = owners.Value.ToDictionary(value => value.PrincipalId, StringComparer.Ordinal); var byRule = assigned.Value.ToLookup(value => value.RuleId);
        if (rules.Any(value => !byOwner.ContainsKey(value.OwnerId))) return Results.Fail<IReadOnlyList<WakeRuleSummary>>("unavailable", "Wake-up owner is missing");
        return Result<IReadOnlyList<WakeRuleSummary>>.Success(rules.Select(rule => new WakeRuleSummary(rule, byOwner[rule.OwnerId], byRule[rule.Id].LongCount(),
            rule.Enabled ? byRule[rule.Id].Select(value => (long?)value.NextDueAt).Min() : null, byRule[rule.Id].Select(value => value.LastDeliveredAt).Max())).ToArray());
    }

    private static Result<long> Validate(WakeRulePorts ports, Actor actor, WakeRuleInput input)
    {
        if (TextRules.Blank(input.Name) || input.Name.Length > 100 || input.Name.Any(value => value is <= '\u001f' or '\u007f') || TextRules.Blank(input.Message)
            || Encoding.UTF8.GetByteCount(input.Message) > 16384 || input.Message.Any(value => value is <= '\u0008' or '\u000b' or '\u000c' or >= '\u000e' and <= '\u001f' or '\u007f')) return Results.Fail<long>("invalid", "Provide a name and a plain-text wake-up message of at most 16 KiB");
        if (input.AgentIds.Count > 1000 || input.AgentIds.Distinct(StringComparer.Ordinal).Count() != input.AgentIds.Count) return Results.Fail<long>("invalid", "Select at most 1000 distinct agents");
        var next = ports.Next(input.Schedule, ports.Discovery.Authorization.Now()); if (!next.IsSuccess) return next;
        foreach (var id in input.AgentIds)
        {
            var target = Authorization.Agent(ports.Discovery.Authorization, actor, id, "configure"); if (!target.IsSuccess) return Result<long>.Fail(target.Error);
            if (target.Value.Principal.Status != "active" || target.Value.Owner.Status != "active") return Results.Fail<long>("conflict", "Only active agents with active owners can be attached");
        }
        return next;
    }

    private static Result<Unit> Assign(WakeRulePorts ports, string ruleId, IReadOnlyList<string> ids, long nextDueAt)
    {
        var before = ports.Assignments([ruleId]); if (!before.IsSuccess) return Result<Unit>.Fail(before.Error);
        var selected = ids.ToHashSet(StringComparer.Ordinal); var previous = before.Value.ToDictionary(value => value.AgentId, StringComparer.Ordinal);
        foreach (var value in before.Value.Where(value => !selected.Contains(value.AgentId)))
        { var removed = ports.RemoveAssignment(ruleId, value.AgentId); if (!removed.IsSuccess) return removed; }
        foreach (var id in ids)
        { var saved = ports.SaveAssignment(new(ruleId, id, nextDueAt, previous.GetValueOrDefault(id)?.LastDeliveredAt)); if (!saved.IsSuccess) return saved; }
        return Results.Done();
    }

    public static Result<WakeRuleDetails> Save(WakeRulePorts ports, Actor actor, string id, WakeRuleInput input, long? expectedRevision, string requestId)
        => ports.Transaction.Run(() =>
        {
            if (actor.Kind != "human") return Results.Fail<WakeRuleDetails>("forbidden", "Only members create Wake-ups");
            WakeRule? previous = null;
            if (expectedRevision is null)
            {
                var allowed = Authorization.Require(ports.Discovery.Authorization, actor, "wake-rule.manage.owned"); if (!allowed.IsSuccess) return Result<WakeRuleDetails>.Fail(allowed.Error);
                var existing = ports.Find(id); if (!existing.IsSuccess) return Result<WakeRuleDetails>.Fail(existing.Error);
                if (existing.Value is { } present)
                {
                    var details = Read(ports, actor, id); if (!details.IsSuccess) return details;
                    return present.OwnerId == actor.PrincipalId && present.Revision == 0 && present.Name == TextRules.Trim(input.Name) && present.Message == input.Message && present.Schedule == input.Schedule && present.Enabled == input.Enabled
                        && details.Value.Agents.Select(value => value.Assignment.AgentId).Order(StringComparer.Ordinal).SequenceEqual(input.AgentIds.Order(StringComparer.Ordinal)) ? details : Results.Fail<WakeRuleDetails>("conflict", "Wake-up ID belongs to a different request");
                }
            }
            else
            {
                var current = Authorized(ports, actor, id, true); if (!current.IsSuccess) return Result<WakeRuleDetails>.Fail(current.Error);
                if (current.Value.Revision != expectedRevision) return Results.Fail<WakeRuleDetails>("stale_revision", "Refresh the Wake-up before saving changes"); previous = current.Value;
            }
            var next = Validate(ports, actor, input); if (!next.IsSuccess) return Result<WakeRuleDetails>.Fail(next.Error);
            var now = ports.Discovery.Authorization.Now(); var rule = new WakeRule(id, previous?.OwnerId ?? actor.PrincipalId, actor.PrincipalId, TextRules.Trim(input.Name), input.Message, input.Schedule, input.Enabled, previous is null ? 0 : checked(previous.Revision + 1), previous?.CreatedAt ?? now, now);
            var saved = ports.Save(rule, previous is null); if (!saved.IsSuccess) return Result<WakeRuleDetails>.Fail(saved.Error);
            if (previous is not null) { var cancelled = ports.CancelPending(id); if (!cancelled.IsSuccess) return Result<WakeRuleDetails>.Fail(cancelled.Error); }
            var assigned = Assign(ports, id, input.AgentIds, next.Value); if (!assigned.IsSuccess) return Result<WakeRuleDetails>.Fail(assigned.Error);
            var action = previous is null ? "create" : "update"; var permission = rule.OwnerId == actor.PrincipalId ? "owned" : "any";
            var audit = ports.Audit(new(requestId, actor.Kind, actor.PrincipalId, rule.OwnerId, "wake-rule", id, "wake-rule." + action, Message: (previous is null ? "Created" : "Updated") + " Wake-up “" + rule.Name + "”.", PermissionCode: "wake-rule.manage." + permission));
            return audit.IsSuccess ? Read(ports, actor, id) : Result<WakeRuleDetails>.Fail(audit.Error);
        });

    public static Result<Unit> Delete(WakeRulePorts ports, Actor actor, string id, long expectedRevision, string requestId)
        => ports.Transaction.Run(() =>
        {
            var rule = Authorized(ports, actor, id, true); if (!rule.IsSuccess) return Result<Unit>.Fail(rule.Error);
            if (rule.Value.Revision != expectedRevision) return Results.Fail<Unit>("stale_revision", "Refresh the Wake-up before deleting it");
            var removed = ports.Remove(id); if (!removed.IsSuccess) return removed;
            return ports.Audit(new(requestId, actor.Kind, actor.PrincipalId, rule.Value.OwnerId, "wake-rule", id, "wake-rule.delete", Message: "Deleted Wake-up “" + rule.Value.Name + "”.", PermissionCode: "wake-rule.manage." + (rule.Value.OwnerId == actor.PrincipalId ? "owned" : "any")));
        });
}
