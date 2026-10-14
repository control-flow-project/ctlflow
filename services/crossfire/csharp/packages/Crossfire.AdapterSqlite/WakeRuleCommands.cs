using Crossfire.AdapterSqlite.Entities;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class WakeRuleCommands
{
    public static Result<Unit> SaveRule(CrossfireDbContext context, WakeRule value, bool create)
    {
        var id = value.Id; var row = create ? new WakeRuleRow { Id = id, OwnerId = value.OwnerId, CreatedAt = value.CreatedAt } : context.WakeRule.Single(row => row.Id == id);
        row.ConfiguredById = value.ConfiguredById; row.Name = value.Name; row.Message = value.Message; row.ScheduleKind = value.Schedule is IntervalSchedule ? "interval" : "cron";
        row.IntervalSeconds = value.Schedule is IntervalSchedule interval ? interval.Seconds : null; row.CronExpression = value.Schedule is CronSchedule cron ? cron.Expression : null; row.TimeZone = value.Schedule is CronSchedule zoned ? zoned.TimeZone : null;
        row.Enabled = value.Enabled ? 1 : 0; row.Revision = value.Revision; row.UpdatedAt = value.UpdatedAt;
        if (create) context.WakeRule.Add(row); context.SaveChanges(); return Results.Done();
    }
    public static Result<Unit> SaveAssignment(CrossfireDbContext context, WakeAssignment value)
    {
        var id = value.RuleId; var agentId = value.AgentId; var row = context.WakeRuleAgent.SingleOrDefault(row => row.RuleId == id && row.AgentId == agentId);
        if (row is null) { row = new() { RuleId = id, AgentId = agentId }; context.WakeRuleAgent.Add(row); }
        row.NextDueAt = value.NextDueAt; row.LastDeliveredAt = value.LastDeliveredAt; context.SaveChanges(); return Results.Done();
    }
    public static Result<Unit> SaveDelivery(CrossfireDbContext context, WakeDelivery value, bool create)
    {
        var id = value.Id; var row = create ? new WakeDeliveryRow { Id = id, RuleId = value.RuleId, AgentId = value.AgentId, RuleRevision = value.RuleRevision,
            SessionId = value.SessionId, ScheduledAt = value.ScheduledAt, CreatedAt = value.CreatedAt } : context.WakeDelivery.Single(row => row.Id == id);
        row.RunId = value.RunId; row.Status = value.Status; row.DeliveredAt = value.DeliveredAt; if (create) context.WakeDelivery.Add(row); context.SaveChanges(); return Results.Done();
    }
    public static Result<Unit> RemoveRule(CrossfireDbContext context, string id)
    { context.WakeRule.Where(row => row.Id == id).ExecuteDelete(); return Results.Done(); }
    public static Result<Unit> RemoveAssignment(CrossfireDbContext context, string ruleId, string agentId)
    { context.WakeRuleAgent.Where(row => row.RuleId == ruleId && row.AgentId == agentId).ExecuteDelete(); return Results.Done(); }
    public static Result<Unit> CancelPending(CrossfireDbContext context, string ruleId)
    { context.WakeDelivery.Where(row => row.RuleId == ruleId && row.Status == "pending").ExecuteUpdate(update => update.SetProperty(row => row.Status, "cancelled")); return Results.Done(); }
    public static WakeRulePorts Rules(CrossfireDbContext context, Func<long> now, Func<WakeSchedule, long, Result<long>> next)
        => new(DiscoveryQueries.Ports(context, now), new SqliteUnitOfWork(context), next, id => WakeQueries.Find(context, id), (value, create) => SaveRule(context, value, create),
            id => RemoveRule(context, id), (owner, search, page, size) => WakeQueries.Page(context, owner, search, page, size), ids => WakeQueries.Assignments(context, ids),
            value => SaveAssignment(context, value), (rule, agent) => RemoveAssignment(context, rule, agent), id => CancelPending(context, id), intent => MemberCommands.Audit(context, intent, now));
    public static WakeDeliveryPorts Deliveries(CrossfireDbContext context, Func<long> now, Func<WakeSchedule, long, Result<long>> next)
        => new(Rules(context, now, next), ListenerCommands.Ports(context, now), id => WakeQueries.FindDelivery(context, id), id => WakeQueries.Pending(context, id),
            (value, create) => SaveDelivery(context, value, create), (agent, at) => WakeQueries.Due(context, agent, at), agent => WakeQueries.NextDueAt(context, agent), Identity.Identifier);
}
