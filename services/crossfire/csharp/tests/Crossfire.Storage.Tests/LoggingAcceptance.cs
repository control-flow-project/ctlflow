using Crossfire.AdapterSqlite;
using Crossfire.AdapterSqlite.Entities;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class LoggingAcceptance
{
    public static void Verify(CrossfireDbContext context, Actor owner, long start)
    {
        var cutoff = start + 86400000; var fixture = FleetFixture.Create(context, owner, start);
        var current = Identity.Identifier(); var pinned = Identity.Identifier(); var terminal = Identity.Identifier();
        var decision = Identity.Identifier(); var closedDecision = Identity.Identifier(); var oldOperation = Identity.Identifier(); var lastStop = Identity.Identifier();
        var oldInvitation = Identity.Identifier(); var claimedInvitation = Identity.Identifier(); var boundary = Identity.Identifier();
        Equal(Transactions.Run(context, () =>
        {
            foreach (var id in new[] { pinned, terminal, current }) context.ListenerRun.Add(new() { Id = id, AgentId = fixture.AgentId, StartedAt = id == current ? start + 1 : start - 1, LastSeenAt = id == current ? start + 1 : start,
                Release = "retention-test", ControllerFleetId = fixture.FleetId, ControllerConnectionId = fixture.ConnectionId, ControllerCredentialId = fixture.CredentialId });
            context.RuntimeObservation.Add(new() { RunId = terminal, AgentId = fixture.AgentId, SessionId = "old", Runtime = "codex", State = "idle", HistoryMode = "shared", MaxInputBytes = 65536, ObservedAt = start });
            context.RuntimeSetting.Add(new() { RunId = terminal, SessionId = "old", Name = "model", EffectiveValue = "test-model" });
            context.RuntimeDecision.Add(new() { Id = decision, AgentId = fixture.AgentId, RunId = pinned, Runtime = "codex", SessionId = "protected", RequestId = "pending", TurnId = "turn", ItemId = "item", Kind = "question", Action = "Review", ReviewText = "private", Status = "answered", CreatedAt = start });
            context.RuntimeDecision.Add(new() { Id = closedDecision, AgentId = fixture.AgentId, RunId = terminal, Runtime = "codex", SessionId = "old", RequestId = "done", TurnId = "turn", ItemId = "item", Kind = "question", Action = "Review", ReviewText = "private", Status = "responded", CreatedAt = start });
            foreach (var id in new[] { oldOperation, lastStop }) context.FleetRuntimeOperation.Add(new() { Id = id, FleetId = fixture.FleetId, AuthorPrincipalId = owner.PrincipalId,
                Action = "stop", Status = "succeeded", CreatedAt = start, CompletedAt = id == lastStop ? start + 1 : start });
            foreach (var id in new[] { oldInvitation, claimedInvitation }) context.MemberInvitation.Add(new() { Id = id, CreatedByMemberId = owner.PrincipalId, ClaimHash = Identity.Hash(Identity.Secret()), RoleCode = "member", PrincipalKind = "human", CreatedAt = start - 1000, ExpiresAt = start,
                ClaimMatrixUserId = id == claimedInvitation ? "@native-created-" + id + ":example.test" : null, ClaimDisplayName = id == claimedInvitation ? "Created" : null, ClaimFingerprint = id == claimedInvitation ? Identity.Hash("claim") : null });
            context.ListenerStatInterval.Add(new() { RunId = terminal, AgentId = fixture.AgentId, BucketAt = start, StartedAt = start, EndedAt = start + 1, CapturedAt = start });
            context.ListenerStatCheckpoint.Add(new() { RunId = terminal, Sequence = 1, CapturedAt = start, Digest = Identity.Hash("sample") });
            context.RuntimeUsageCheckpoint.Add(new() { AgentId = fixture.AgentId, Runtime = "codex", SessionId = "old", CapturedAt = start });
            context.AuditEvent.Add(new() { Id = boundary, RequestId = Identity.Identifier(), ActorKind = "human", ActorPrincipalId = owner.PrincipalId, OwnerId = owner.PrincipalId,
                TargetKind = "agent", TargetId = fixture.AgentId, Action = "listener.report", Outcome = "accepted", Message = "boundary", CreatedAt = cutoff });
            return Results.Done();
        }).IsSuccess, true, "retention fixtures respect the canonical deployed schema");
        Equal(LoggingRetention.Prune(context, cutoff, 0, new()).Error.Code, "invalid", "cleanup batch lower bound");
        Equal(LoggingRetention.Prune(context, cutoff, 1001, new()).Error.Code, "invalid", "cleanup batch upper bound");
        var scan = new LoggingScan(); var drained = false; long removed = 0;
        for (var attempt = 0; attempt < 5000; attempt++)
        {
            var batch = LoggingRetention.Prune(context, cutoff, 1, scan); Equal(batch.IsSuccess, true, "bounded cleanup batch commits");
            scan = batch.Value.Scan; removed += batch.Value.Removed; if (!batch.Value.More) { drained = true; break; }
        }
        Equal(drained, true, "protected old records cannot starve bounded cleanup");
        Equal(removed > 0, true, "logging cleanup reclaims obsolete rows");
        Equal(context.ListenerRun.AsNoTracking().Any(row => row.Id == terminal), false, "obsolete listener and dependent observations are reclaimed");
        Equal(context.RuntimeSetting.AsNoTracking().Any(row => row.RunId == terminal), false, "old runtime settings are reclaimed with their observation");
        Equal(context.ListenerRun.AsNoTracking().Any(row => row.Id == current), true, "latest listener remains the native status projection");
        Equal(context.ListenerRun.AsNoTracking().Any(row => row.Id == pinned), true, "unanswered native workflow retains its listener");
        Equal(context.RuntimeDecision.AsNoTracking().Any(row => row.Id == decision), true, "answered decision is retained until native acceptance");
        Equal(context.RuntimeDecision.AsNoTracking().Any(row => row.Id == closedDecision), false, "settled native decision expires");
        Equal(context.FleetRuntimeOperation.AsNoTracking().Any(row => row.Id == lastStop), true, "latest successful fleet stop survives retention");
        Equal(context.FleetRuntimeOperation.AsNoTracking().Any(row => row.Id == oldOperation), false, "superseded stop operation is reclaimed");
        Equal(context.MemberInvitation.AsNoTracking().Any(row => row.Id == oldInvitation), false, "expired unclaimed invitation is reclaimed");
        Equal(context.MemberInvitation.AsNoTracking().Any(row => row.Id == claimedInvitation), true, "unfinished native signup claim must not be erased");
        Equal(context.AuditEvent.AsNoTracking().Any(row => row.Id == boundary), true, "exact retention boundary is included");
        Equal(LoggingRetention.Prune(context, cutoff + 1, 1000, scan).IsSuccess, true, "later cutoff resumes bounded scans");
        Equal(context.AuditEvent.AsNoTracking().Any(row => row.Id == boundary), false, "one millisecond beyond retention expires boundary event");
        Equal(LoggingRetention.Prune(context, start - 1, 1000, scan).Value.Scan.PreviousCutoff, start - 1, "backwards cutoff restarts scans without deleting current state");
        Equal(AuthorizationQueries.Principal(context, fixture.AgentId).Value!.Status, "active", "logging retention never resets accounts or current native state");
    }
}
