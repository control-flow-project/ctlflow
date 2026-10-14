using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class DecisionAcceptance
{
    public static void Verify(CrossfireDbContext context, Actor owner, Actor administrator, long started)
    {
        var now = started;
        var fixture = FleetFixture.Create(context, owner, now);
        var ports = DecisionCommands.Ports(context, () => now);
        var agent = fixture.AgentId; var actor = fixture.Actor;
        var input = new DecisionCreation(Identity.Identifier(), fixture.RunId, "codex", "native-session", "native-request", "native-turn", "native-item",
            "question", "Select a destination", "Private native review", true, now + 60000,
            [new("destination", "Destination", "Where should this go?", false, false, [new("room", "This room", "Publish here"), new("dm", "Owner DM", "Keep private")]),
             new("detail", "Details", "Add optional context", true, true, [])]);
        var created = Decisions.Create(ports, actor, agent, input);
        Equal(created.IsSuccess, true, "native decision creation");
        Equal(created.Value.Status, "pending", "decision begins pending");
        Equal(Decisions.Create(ports, actor, agent, input).Value.CreatedAt, created.Value.CreatedAt, "decision replay is idempotent");
        Equal(Decisions.Create(ports, actor, agent, input with { Review = "Different review" }).Error.Code, "conflict", "identity cannot change native review");
        Equal(Decisions.Create(ports, actor, agent, input with { Questions = input.Questions.Reverse().ToArray() }).Error.Code, "conflict", "identity cannot reorder native questions");
        Equal(Decisions.Create(ports, actor, agent, input with { Runtime = "claude" }).Error.Code, "invalid", "unimplemented runtime rejected");
        Equal(Decisions.Create(ports, owner, agent, input).Error.Code, "forbidden", "human cannot report native decision");
        Equal(Decisions.Read(ports, owner, agent, input.Id).Value.Native.Questions[0].Options[1].Id, "dm", "ordered native options retained");
        Equal(Decisions.Answer(ports, administrator, agent, input.Id, [], Identity.Identifier()).Error.Code, "missing", "administrator is not native answer owner");
        Equal(Decisions.Poll(ports, owner, agent, input.Id).Error.Code, "forbidden", "owner cannot use native answer polling port");
        Equal(Decisions.Receipt(ports, actor, agent, input.Id, "responded").Error.Code, "conflict", "cannot receipt an unanswered request");
        Equal(Decisions.Answer(ports, owner, agent, input.Id, [new("destination", "room", null)], Identity.Identifier()).Error.Code, "invalid", "every question must be answered");
        Equal(Decisions.Answer(ports, owner, agent, input.Id, [new("destination", "room", null), new("destination", "dm", null)], Identity.Identifier()).Error.Code, "invalid", "duplicate answer identity rejected");
        Equal(Decisions.Answer(ports, owner, agent, input.Id, [new("destination", "elsewhere", null), new("detail", null, "Private answer")], Identity.Identifier()).Error.Code, "invalid", "unknown native choice rejected");
        Equal(Decisions.Answer(ports, owner, agent, input.Id, [new("destination", null, "Free text"), new("detail", null, "Private answer")], Identity.Identifier()).Error.Code, "invalid", "free text disabled for choice question");
        var answers = new DecisionAnswer[] { new("destination", "room", null), new("detail", null, "Private answer") };
        var failingAudit = ports with { Audit = _ => Results.Fail<Unit>("limit", "verification audit failure") };
        Equal(Decisions.Answer(failingAudit, owner, agent, input.Id, answers, Identity.Identifier()).Error.Code, "limit", "answer propagates audit failure");
        Equal(DecisionQueries.Find(context, input.Id).Value!.Status, "pending", "audit failure rolls back answer status");
        Equal(DecisionQueries.Answers(context, input.Id).Value.Count, 0, "audit failure rolls back private answer rows");
        Equal(Decisions.Answer(ports, owner, agent, input.Id, answers, Identity.Identifier()).IsSuccess, true, "owner answers native request");
        Equal(Decisions.Poll(ports, actor, agent, input.Id).Value.Status, "answered", "native process observes owner answer");
        Equal(Decisions.Poll(ports, actor, agent, input.Id).Value.Answers.Single(answer => answer.QuestionId == "detail").Text, "Private answer", "private text returned only to original agent");
        Equal(context.AuditEvent.AsNoTracking().Where(row => row.TargetId == input.Id).Single().Message.Contains("Private answer", StringComparison.Ordinal), false, "private answer never copied to audit");
        Equal(Decisions.Answer(ports, owner, agent, input.Id, answers, Identity.Identifier()).Error.Code, "conflict", "answered decision cannot be replaced");
        Equal(Decisions.Receipt(ports, actor, agent, input.Id, "responded").Value, true, "native decision receipt");
        Equal(Decisions.Receipt(ports, actor, agent, input.Id, "responded").Value, true, "native receipt is idempotent");
        Equal(DecisionQueries.Answers(context, input.Id).Value.Count, 0, "settled private answers deleted");
        Equal(Decisions.Receipt(ports, actor, agent, input.Id, "cancelled").Error.Code, "conflict", "settled native request cannot cancel");
        Equal(Decisions.Receipt(ports, actor, agent, Identity.Identifier(), "cancelled").Value, false, "missing native request receipt reports unrecorded");
        var pending = input with { Id = Identity.Identifier(), Runtime = "pi", RequestId = "pi-question", ExpiresAt = now + 1000 };
        Equal(Decisions.Create(ports, actor, agent, pending).IsSuccess, true, "Pi native decision uses same domain");
        Equal(Decisions.List(ports, owner, agent, 1, 1).Value.TotalPages, 2L, "decision pagination excludes large review body");
        Equal(Decisions.List(ports, owner, agent, 1, 20, "pending").Value.TotalItems, 1L, "decision pending filter");
        Equal(Decisions.List(ports, owner, agent, 100001, 20).Error.Code, "invalid", "decision page bound");
        now += 1000;
        Equal(Decisions.Read(ports, owner, agent, pending.Id).Value.Status, "expired", "read calculates native request expiry");
        Equal(DecisionQueries.Find(context, pending.Id).Value!.Status, "pending", "read does not persist expiry");
        Equal(Decisions.List(ports, owner, agent, 1, 20, "pending").Value.TotalItems, 0L, "listing settles expired decision");
        Equal(Decisions.List(ports, owner, agent, 1, 20, "pending").Value.TotalPages, 1L, "empty page still has one page");
        var lost = input with { Id = Identity.Identifier(), RequestId = "lost-controller-question", ExpiresAt = null };
        Equal(Decisions.Create(ports, actor, agent, lost).IsSuccess, true, "nonexpiring native request created");
        var connection = context.FleetConnection.Single(row => row.FleetId == fixture.FleetId);
        connection.ConnectionId = Identity.Identifier(); context.SaveChanges();
        Equal(Decisions.Read(ports, owner, agent, lost.Id).Value.Status, "expired", "replaced controller invalidates original native request");
        Equal(Decisions.Answer(ports, owner, agent, lost.Id, answers, Identity.Identifier()).Error.Code, "conflict", "owner cannot answer request from old controller generation");
        connection = context.FleetConnection.Single(row => row.FleetId == fixture.FleetId);
        connection.ConnectionId = fixture.ConnectionId; context.SaveChanges();
        Equal(ListenerQueries.Live(context, agent, fixture.RunId, now).IsSuccess, true, "original controller lease admission");
        Equal(ListenerQueries.Live(context, agent, fixture.RunId, started + ControllerAdmission.HeartbeatExpiryMs).Error.Code, "conflict", "heartbeat equality expires listener");
        VerifyAdmission(context, fixture, now);
    }

    private static void VerifyAdmission(CrossfireDbContext context, ManagedAgent fixture, long now)
    {
        var credential = context.FleetCredential.Single(row => row.Id == fixture.CredentialId);
        credential.RevokedAt = now; context.SaveChanges();
        Equal(ListenerQueries.Live(context, fixture.AgentId, fixture.RunId, now).Error.Code, "conflict", "revoked controller credential rejected");
        credential.RevokedAt = null; context.SaveChanges();
        var fleet = context.Fleet.Single(row => row.Id == fixture.FleetId);
        fleet.DeliveryEnabled = 0; context.SaveChanges();
        Equal(ListenerQueries.Live(context, fixture.AgentId, fixture.RunId, now).Error.Code, "conflict", "paused delivery invalidates run authority");
        fleet.DeliveryEnabled = 1; context.SaveChanges();
        var run = context.ListenerRun.Single(row => row.Id == fixture.RunId);
        run.DisconnectRequestedAt = now; context.SaveChanges();
        Equal(ListenerQueries.Live(context, fixture.AgentId, fixture.RunId, now).Error.Code, "conflict", "disconnecting listener cannot accept native decisions");
        run.DisconnectRequestedAt = null; run.StoppedAt = now; context.SaveChanges();
        Equal(ListenerQueries.Live(context, fixture.AgentId, fixture.RunId, now).Error.Code, "conflict", "stopped listener cannot accept native decisions");
    }
}
