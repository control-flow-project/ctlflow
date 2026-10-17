using Crossfire.AdapterSqlite.Entities;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class WakeQueries
{
    public static WakeRule Rule(WakeRuleRow row) => new(row.Id, row.OwnerId, row.ConfiguredById, row.Name, row.Message,
        row.ScheduleKind == "interval" ? new IntervalSchedule(row.IntervalSeconds!.Value) : new CronSchedule(row.CronExpression!, row.TimeZone!), row.Enabled == 1, row.Revision, row.CreatedAt, row.UpdatedAt);
    public static WakeAssignment Assignment(WakeRuleAgentRow row) => new(row.RuleId, row.AgentId, row.NextDueAt, row.LastDeliveredAt);
    public static WakeDelivery Delivery(WakeDeliveryRow row) => new(row.Id, row.RuleId, row.AgentId, row.RuleRevision, row.RunId, row.SessionId, row.ScheduledAt, row.CreatedAt, row.Status, row.DeliveredAt);
    public static Result<WakeRule?> Find(CrossfireDbContext context, string id)
        => Stored.Read(() => context.WakeRule.AsNoTracking().SingleOrDefault(row => row.Id == id)).Map(value => value is null ? null : Rule(value));
    public static Result<IReadOnlyList<WakeAssignment>> Assignments(CrossfireDbContext context, IReadOnlyList<string> requested)
    {
        var ids = requested.ToArray();
        return Stored.Read(() => context.WakeRuleAgent.AsNoTracking().Where(row => ids.Contains(row.RuleId)).OrderBy(row => row.RuleId).ThenBy(row => row.AgentId).ToArray()).Map<IReadOnlyList<WakeAssignment>>(values => values.Select(Assignment).ToArray());
    }
    public static Result<Page<WakeRule>> Page(CrossfireDbContext context, string? ownerId, string search, int page, int size)
    {
        var offset = checked((page - 1) * size); var pattern = "%" + search + "%";
        var count = Stored.Read(() => context.WakeRule.AsNoTracking().LongCount(row => (ownerId == null || row.OwnerId == ownerId) && EF.Functions.Like(row.Name, pattern))); if (!count.IsSuccess) return Result<Page<WakeRule>>.Fail(count.Error);
        return Stored.Read(() => context.WakeRule.AsNoTracking().Where(row => (ownerId == null || row.OwnerId == ownerId) && EF.Functions.Like(row.Name, pattern)).OrderByDescending(row => row.CreatedAt).ThenBy(row => row.Id).Skip(offset).Take(size).ToArray())
            .Map(values => new Page<WakeRule>(values.Select(Rule).ToArray(), page, size, count.Value));
    }
    public static Result<WakeDelivery?> FindDelivery(CrossfireDbContext context, string id)
        => Stored.Read(() => context.WakeDelivery.AsNoTracking().SingleOrDefault(row => row.Id == id)).Map(value => value is null ? null : Delivery(value));
    public static Result<WakeDelivery?> Pending(CrossfireDbContext context, string agentId)
        => Stored.Read(() => context.WakeDelivery.AsNoTracking().Where(row => row.AgentId == agentId && row.Status == "pending").OrderBy(row => row.CreatedAt).ThenBy(row => row.Id).FirstOrDefault()).Map(value => value is null ? null : Delivery(value));
    public static Result<long?> NextDueAt(CrossfireDbContext context, string agentId)
        => Stored.Read(() => context.WakeRuleAgent.AsNoTracking().Where(row => row.AgentId == agentId)
            .Join(context.WakeRule.Where(row => row.Enabled == 1), row => row.RuleId, rule => rule.Id, (row, rule) => (long?)row.NextDueAt).OrderBy(value => value).FirstOrDefault());
    public static Result<IReadOnlyList<DueWake>> Due(CrossfireDbContext context, string agentId, long now)
        => Stored.Read(() => context.WakeRuleAgent.AsNoTracking().Where(row => row.AgentId == agentId && row.NextDueAt <= now)
            .Join(context.WakeRule.Where(row => row.Enabled == 1), assignment => assignment.RuleId, rule => rule.Id, (assignment, rule) => new { assignment, rule })
            .OrderBy(value => value.assignment.NextDueAt).ThenBy(value => value.rule.Id).Take(100).ToArray()).Map<IReadOnlyList<DueWake>>(values => values.Select(value => new DueWake(Rule(value.rule), Assignment(value.assignment))).ToArray());
}
