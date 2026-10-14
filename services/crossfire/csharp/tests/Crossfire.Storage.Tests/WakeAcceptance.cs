using Crossfire.AdapterSchedule;
using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class WakeAcceptance
{
    public static void Verify(CrossfireDbContext context, Actor owner, Actor administrator, long start)
    {
        Schedule(); var now = start; var fixture = FleetFixture.Create(context, owner, now); var other = FleetFixture.Create(context, administrator, now);
        var rules = WakeRuleCommands.Rules(context, () => now, CalendarSchedule.Next); var deliveries = WakeRuleCommands.Deliveries(context, () => now, CalendarSchedule.Next);
        var id = Identity.Identifier(); var input = new WakeRuleInput("Fetch reports", "Read the newly available reports.", new IntervalSchedule(60), true, [fixture.AgentId]);
        var created = WakeRules.Save(rules, owner, id, input, null, Identity.Identifier());
        Equal(created.IsSuccess, true, "scheduled rule and normalized assignments persist atomically");
        Equal(created.Value.Summary.NextDueAt, now + 60000, "new interval deadline starts at the save time");
        Equal(WakeRules.Save(rules, owner, id, input, null, Identity.Identifier()).Value.Summary.Rule.Revision, 0L, "identical creation retries do not move the cadence");
        Equal(WakeRules.Save(rules, owner, id, input with { Message = "Different" }, null, Identity.Identifier()).Error.Code, "conflict", "rule identifier cannot be reused for another request");
        Equal(WakeRules.Save(rules, owner, Identity.Identifier(), input with { AgentIds = [other.AgentId] }, null, Identity.Identifier()).IsSuccess, false, "owners cannot schedule foreign agents");
        Equal(WakeRules.Read(rules, administrator, id).IsSuccess, true, "administrator can inspect another owner's rule");
        Equal(WakeRules.List(rules, owner, administrator.PrincipalId, "", 1, 20).Error.Code, "forbidden", "listing cannot expand an owner's scope");
        Equal(WakeRules.List(rules, administrator, null, "Fetch", 1, 20).Value.TotalItems, 1L, "rule list uses paginated indexed name filtering");
        var attachment = new WakeAttachment(fixture.RunId, "retained-native-history");
        Equal(WakeDeliveries.Claim(deliveries, fixture.Actor, fixture.AgentId, attachment).Value is null, true, "early claim never invents a scheduled input");
        now += 250000;
        Equal(Transactions.Run(context, () =>
        {
            context.ListenerRun.Single(row => row.Id == fixture.RunId).LastSeenAt = now;
            context.SaveChanges(); return Results.Done();
        }).IsSuccess, true, "controlled live listener observation");
        var failing = deliveries with { Save = (_, _) => Results.Fail<Unit>("unavailable", "Controlled write failure") };
        Equal(WakeDeliveries.Claim(failing, fixture.Actor, fixture.AgentId, attachment).Error.Code, "unavailable", "failed native-delivery reservation reports expected failure");
        Equal(WakeQueries.Assignments(context, [id]).Value[0].NextDueAt, start + 60000, "failed reservation rolls back deadline advancement");
        var claim = WakeDeliveries.Claim(deliveries, fixture.Actor, fixture.AgentId, attachment).Value!;
        Equal(claim.RuleId, id, "due delivery binds the exact configured rule");
        Equal(claim.ScheduledAt, start + 60000, "coalesced delivery retains the original due timestamp");
        Equal(WakeQueries.Assignments(context, [id]).Value[0].NextDueAt, start + 300000, "late delivery preserves interval cadence without replaying missed periods");
        Equal(WakeDeliveries.Claim(deliveries, fixture.Actor, fixture.AgentId, attachment).Value?.DeliveryId, claim.DeliveryId, "same-session retry returns the same delivery");
        Equal(WakeDeliveries.Claim(deliveries, fixture.Actor, fixture.AgentId, attachment with { SessionId = "different-history" }).Value is null, true, "uncertain input cannot move to another native history");
        Equal(WakeDeliveries.Metadata(deliveries, fixture.Actor, fixture.AgentId, attachment).Value.NextDueAt, now, "pending exact-session input is immediately recoverable");
        Equal(WakeDeliveries.Validate(deliveries, fixture.Actor, fixture.AgentId, claim.DeliveryId, attachment).Value, true, "unchanged current authority admits the claim");
        Equal(WakeDeliveries.Acknowledge(deliveries, fixture.Actor, fixture.AgentId, claim.DeliveryId, attachment with { SessionId = "wrong" }).Error.Code, "missing", "a different history cannot acknowledge publication");
        Equal(WakeDeliveries.Acknowledge(deliveries, other.Actor, fixture.AgentId, claim.DeliveryId, attachment).IsSuccess, false, "a different agent cannot acknowledge another agent's delivery");
        var changed = WakeRules.Save(rules, owner, id, input with { Enabled = false }, 0, Identity.Identifier());
        Equal(changed.Value.Summary.NextDueAt is null, true, "disabled rule hides future deadlines");
        Equal(WakeDeliveries.Validate(deliveries, fixture.Actor, fixture.AgentId, claim.DeliveryId, attachment).Value, false, "saving a rule invalidates queued publication admission");
        Equal(WakeQueries.FindDelivery(context, claim.DeliveryId).Value?.Status, "cancelled", "invalidated delivery is cancelled rather than reported delivered");
        Equal(WakeDeliveries.Acknowledge(deliveries, fixture.Actor, fixture.AgentId, claim.DeliveryId, attachment).Value, true, "an exact late native receipt may record publication already accepted");
        Equal(WakeDeliveries.Acknowledge(deliveries, fixture.Actor, fixture.AgentId, claim.DeliveryId, attachment).Value, true, "native publication receipt is idempotent");
        Equal(WakeRules.Read(rules, owner, id).Value.Summary.LastDeliveredAt, now, "receipt confirmation owns the last delivered time");
        Equal(WakeRules.Delete(rules, owner, id, 0, Identity.Identifier()).Error.Code, "stale_revision", "deletion requires the reviewed revision");
        var auditFailure = rules with { Audit = _ => Results.Fail<Unit>("unavailable", "Controlled audit failure") };
        Equal(WakeRules.Save(auditFailure, owner, id, input, 1, Identity.Identifier()).IsSuccess, false, "audit failure is not a successful schedule change");
        Equal(WakeRules.Read(rules, owner, id).Value.Summary.Rule.Enabled, false, "failed mutation rolls back rule and assignment changes");
        Equal(WakeRules.Delete(rules, owner, id, 1, Identity.Identifier()).IsSuccess, true, "deletion removes the normalized rule");
        Equal(WakeQueries.Assignments(context, [id]).Value.Count, 0, "rule deletion cascades assignments");
        Equal(WakeDeliveries.Acknowledge(deliveries, fixture.Actor, fixture.AgentId, claim.DeliveryId, attachment).Value, false, "deleted delivery is never reconstructed from a receipt");
    }

    private static void Schedule()
    {
        static long Time(string value) => DateTimeOffset.Parse(value, System.Globalization.CultureInfo.InvariantCulture).ToUnixTimeMilliseconds();
        Equal(CalendarSchedule.Next(new IntervalSchedule(30), 1000).Value, 31000L, "interval scheduling is exact integer arithmetic");
        Equal(CalendarSchedule.Next(new IntervalSchedule(1), 9007199254740990).Error.Code, "invalid", "interval overflow is refused");
        var cases = new[]
        {
            ("0 22 * * 3", "Asia/Kolkata", "2026-10-06T18:00:00Z", "2026-10-07T16:30:00Z"),
            ("0 1 * * 0,3,4", "UTC", "2026-10-05T00:00:00Z", "2026-10-07T01:00:00Z"),
            ("*/15 8-10 * * MON-THU", "UTC", "2026-10-05T08:01:00Z", "2026-10-05T08:15:00Z"),
            ("30 2 * * *", "America/New_York", "2026-03-08T06:00:00Z", "2026-03-08T07:30:00Z"),
            ("30 2 * * *", "America/New_York", "2026-03-08T07:30:00Z", "2026-03-09T06:30:00Z"),
            ("30 1 * * *", "America/New_York", "2026-11-01T04:00:00Z", "2026-11-01T05:30:00Z"),
            ("30 1 * * *", "America/New_York", "2026-11-01T05:30:00Z", "2026-11-02T06:30:00Z"),
            ("0 0 L * *", "UTC", "2026-02-01T00:00:00Z", "2026-02-28T00:00:00Z"),
            ("0 0 * * 1#2", "UTC", "2026-10-01T00:00:00Z", "2026-10-12T00:00:00Z"),
            ("0 0 13 * 5", "UTC", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z")
        };
        foreach (var (expression, zone, after, expected) in cases)
            Equal(CalendarSchedule.Next(new CronSchedule(expression, zone), Time(after)).Value, Time(expected), "calendar occurrence " + expression + "/" + zone + "/" + after);
        foreach (var expression in new[] { "* * * * * *", "H * * * *", "77 * * * *", "0 0 31 2 *", "0 0 * *", "*/0 * * * *", "0 0 * * 1#6" })
            Equal(CalendarSchedule.Next(new CronSchedule(expression, "UTC"), Time("2026-10-01T00:00:00Z")).IsSuccess, false, "invalid calendar is refused: " + expression);
        Equal(CalendarSchedule.Next(new CronSchedule("* * * * *", "Not/AZone"), 1000).IsSuccess, false, "implicit or unknown zone never substitutes the server time zone");
    }
}
