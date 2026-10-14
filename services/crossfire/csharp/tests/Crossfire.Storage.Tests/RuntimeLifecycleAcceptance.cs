using Crossfire.AdapterMatrix;
using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class RuntimeLifecycleAcceptance
{
    public static void Verify(CrossfireDbContext context, Actor owner, long start)
    {
        var now = start;
        var fixture = FleetFixture.Create(context, owner, now);
        var credential = FleetAuthority.ControllerToken(fixture.CredentialId, Identity.Secret());
        Equal(Transactions.Run(context, () =>
        {
            var id = fixture.CredentialId;
            context.FleetCredential.Single(row => row.Id == id).SecretHash = Identity.Hash(credential);
            return Results.Done();
        }).IsSuccess, true, "authenticated runtime lifecycle controller fixture");
        var listeners = ListenerCommands.Ports(context, () => now);
        var controller = new FleetControllerActor(fixture.FleetId, fixture.CredentialId);
        var proof = new ControllerProof(fixture.FleetId, fixture.ConnectionId, credential);
        var runId = Identity.Identifier(); now++;
        var report = new ListenerReport("test-release", 4, false, proof);
        Equal(ListenerReporting.Report(listeners, fixture.Actor, fixture.AgentId, runId, report with { Release = "old-release" }, "test-release").Error.Code,
            "conflict", "fresh listener must use current release");
        Equal(ListenerReporting.Report(listeners, fixture.Actor, fixture.AgentId, runId, report, "test-release").IsSuccess, true, "generation-bound native listener registration");
        now += 30000;
        Equal(ListenerReporting.Report(listeners, fixture.Actor, fixture.AgentId, runId, report with { MessagesDelivered = 2 }, "test-release").IsSuccess, true, "same generation listener heartbeat");
        Equal(ListenerQueries.Find(context, runId).Value!.MessagesDelivered, 4L, "listener delivered total never goes backwards");
        Equal(ListenerQueries.Find(context, runId).Value!.ActiveMs, 30000L, "bounded native heartbeat duration accumulation");
        Equal(ListenerReporting.Activity(listeners, fixture.AgentId).Value.Status, "online", "valid current lease admits recent listener");
        Equal(ListenerQueries.Totals(context, fixture.AgentId).Value!.MessagesDelivered, 4L, "database-side listener totals");
        Equal(ListenerReporting.Report(listeners, fixture.Actor, fixture.AgentId, runId, report with { Controller = proof with { ConnectionId = Identity.Identifier() } }, "test-release").Error.Code,
            "conflict", "listener identity cannot move to a different controller generation");
        using var matrix = new AccountAuthority(new("http://127.0.0.1:9", "example.test", "test-jwt", "test-registration", "@crossfire:example.test"));
        var runtimes = RuntimeCommands.Ports(context, () => now, matrix.Ports(), "https://example.test", "@crossfire:example.test");
        var observation = new RuntimeObservation(runId, "native-history", null, "codex", "working", now, now, true, "shared", 65536,
            [new("model", "native-model", "native-model"), new("model_reasoning_effort", "high", "high")], null);
        Equal(RuntimeObservations.Report(runtimes, fixture.Actor, fixture.AgentId, observation).IsSuccess, true, "observed native work and public settings persist");
        Equal(RuntimeQueries.Observations(context, fixture.AgentId).Value.Single().Settings.Count, 2, "runtime configuration is normalized, not stored as a private blob");
        Equal(RuntimeObservations.Report(runtimes, fixture.Actor, fixture.AgentId, observation with { Settings = [new("access_token", "private", "private")] }).Error.Code,
            "invalid", "private runtime settings never enter public management state");
        Equal(RuntimeObservations.Report(runtimes, fixture.Actor, fixture.AgentId, observation with { Settings = [new("model", null, "one"), new("model", null, "two")] }).Error.Code,
            "invalid", "duplicate public setting keys rejected");
        Equal(RuntimeObservations.Report(runtimes, fixture.Actor, fixture.AgentId, observation with { RoomId = "!different:example.test" }).Error.Code,
            "conflict", "native history room scope cannot change within one listener generation");
        Equal(RuntimeObservations.Report(runtimes, fixture.Actor, fixture.AgentId, observation with { ObservedAt = now - 1 }).Error.Code,
            "conflict", "older native activity cannot overwrite the current observation");
        var secondary = observation with { SessionId = "secondary-history", State = "idle", HistoryAvailable = false };
        Equal(RuntimeObservations.Report(runtimes, fixture.Actor, fixture.AgentId, secondary).IsSuccess, true, "second independently identified history observation");
        Equal(RuntimeQueries.Summary(context, fixture.AgentId).Value!.State, "working", "working history has priority over idle history");
        Equal(RuntimeQueries.Summary(context, fixture.AgentId).Value!.HistoryAvailable, false, "missing history remains visible in aggregate");
        Equal(RuntimeObservations.Report(runtimes, fixture.Actor, fixture.AgentId, observation with { State = "failed", ErrorMessage = "Exact native failure" }).IsSuccess,
            true, "native failure creates durable owner incident and notification");
        Equal(IncidentCommands.Active(context, fixture.AgentId, null).Value.Count, 1, "one active native failure episode");
        Equal(RuntimeObservations.Report(runtimes, fixture.Actor, fixture.AgentId, observation with { State = "failed", ErrorMessage = "Exact native failure" }).IsSuccess,
            true, "native failure retry does not duplicate incident");
        var incident = IncidentCommands.Active(context, fixture.AgentId, null).Value.Single();
        Equal(IncidentCommands.Notification(context, incident.Id, "initial").Value!.Body.Contains("Exact native failure", StringComparison.Ordinal), true,
            "failure owner notice retains the actual native cause");
        Equal(RuntimeObservations.Report(runtimes, fixture.Actor, fixture.AgentId, observation with { State = "idle" }).IsSuccess, true, "verified native recovery closes its matching incident");
        Equal(IncidentCommands.Find(context, incident.Id).Value!.RecoveredAt, now, "native recovery is timestamped");
        Equal(IncidentCommands.Notification(context, incident.Id, "recovery").Value!.EventId is null, true, "recovery notification remains pending until Matrix confirms publication");
        var retirement = RetirementCommands.Ports(context, () => now);
        Equal(FleetRetirement.RecordStop(retirement, controller, fixture.FleetId, fixture.AgentId, fixture.ConnectionId, runId, Identity.Identifier()).Error.Code,
            "conflict", "reporting listener must stop before native close receipt");
        Equal(ListenerReporting.Report(listeners, fixture.Actor, fixture.AgentId, runId, report with { Stopped = true }, "test-release").IsSuccess, true, "listener shutdown report");
        var stoppedRun = ListenerQueries.Find(context, runId).Value!;
        Equal(ListenerReporting.Report(listeners, fixture.Actor, fixture.AgentId, runId, report, "test-release").Value.Closed, true, "closed listener generation cannot resurrect");
        Equal(ListenerQueries.Find(context, runId).Value!.StoppedAt, stoppedRun.StoppedAt, "late heartbeat preserves actual stop timestamp");
        var receiptId = Identity.Identifier();
        Equal(FleetRetirement.RecordStop(retirement, controller, fixture.FleetId, fixture.AgentId, fixture.ConnectionId, runId, receiptId).IsSuccess, true,
            "current controller records exact native-close receipt");
        Equal(FleetRetirement.RecordStop(retirement, controller, fixture.FleetId, fixture.AgentId, fixture.ConnectionId, runId, receiptId).IsSuccess, true,
            "same native-stop receipt is idempotent");
        var snapshot = RetirementQueries.Snapshot(context, [fixture.AgentId], [], now).Value;
        Equal(FleetRetirement.Eligible(snapshot.Agents.Single(), now), true, "settled exact generation native stop allows retirement");
        Equal(RuntimeQueries.Summary(context, fixture.AgentId).Value!.State, "stopped", "native-close proof replaces stale idle or working status");
        Equal(FleetRetirement.Eligible(snapshot.Agents.Single() with { PendingOperation = true }, now), false, "pending native operation prevents retirement");
        Equal(FleetRetirement.Eligible(snapshot.Agents.Single() with { PendingDecision = true }, now), false, "unsettled human decision prevents retirement");
        Equal(FleetRetirement.Eligible(snapshot.Agents.Single() with { PendingWake = true }, now), false, "unsettled scheduled delivery prevents retirement");
        Equal(FleetRetirement.Eligible(snapshot.Agents.Single() with { PendingBroadcast = true }, now), false, "unsettled broadcast prevents retirement");
        var nextRun = Identity.Identifier(); now++;
        Equal(ListenerReporting.Report(listeners, fixture.Actor, fixture.AgentId, nextRun, report, "test-release").IsSuccess, true, "new listener generation resumes saved native identity");
        Equal(RuntimeObservations.Report(runtimes, fixture.Actor, fixture.AgentId, observation with { RunId = nextRun, ObservedAt = now, State = "working" }).IsSuccess, true,
            "new verified native activity invalidates old native-close proof");
        Equal(RetirementQueries.Stop(context, fixture.AgentId).Value!.InvalidatedAt, now, "old stop receipt is explicitly invalidated");
        Equal(FleetRetirement.RecordStop(retirement, controller, fixture.FleetId, fixture.AgentId, fixture.ConnectionId, runId, receiptId).Error.Code,
            "conflict", "old receipt cannot prove a newer listener is stopped");
        Equal(ListenerReporting.Report(listeners, fixture.Actor, fixture.AgentId, nextRun, report with { Stopped = true }, "test-release").IsSuccess, true, "second generation shuts down");
        Equal(FleetRetirement.RecordStop(retirement, controller, fixture.FleetId, fixture.AgentId, fixture.ConnectionId, nextRun, Identity.Identifier()).IsSuccess,
            true, "second native-close receipt covers the second generation");
        Equal(RetirementQueries.Stop(context, fixture.AgentId).Value!.Sequence, 2L, "native close evidence uses monotonic per-agent sequence");
        var revision = FleetQueries.Find(context, fixture.FleetId).Value!.Revision;
        var failure = retirement with { Fleet = retirement.Fleet with { Audit = _ => Results.Fail<Unit>("unavailable", "Injected retirement audit failure") } };
        Equal(FleetRetirement.Remove(failure, new FleetPrincipalActor(owner), fixture.FleetId, fixture.AgentId, "test-agent", revision, Identity.Identifier()).Error.Code,
            "unavailable", "failed retirement audit aborts the whole change");
        Equal(AuthorizationQueries.Binding(context, fixture.AgentId).Value!.RetiredAt is null, true, "retirement failure preserves current binding");
        Equal(AuthorizationQueries.Principal(context, fixture.AgentId).Value!.Status, "active", "retirement failure preserves active identity");
        Equal(FleetRetirement.Remove(retirement, new FleetPrincipalActor(owner), fixture.FleetId, fixture.AgentId, "test-agent", revision, Identity.Identifier()).IsSuccess,
            true, "settled owner retirement succeeds atomically");
        Equal(AuthorizationQueries.Principal(context, fixture.AgentId).Value!.Status, "suspended", "retired stable identity is suspended, never deleted");
        Equal(Authorization.ActiveActor(retirement.Fleet.Authorization, fixture.Actor).IsSuccess, false, "retired identity cannot authenticate as an active listener");
        Equal(FleetRetirement.Archive(retirement, new FleetPrincipalActor(owner), fixture.FleetId, revision + 1, Identity.Identifier()).IsSuccess, true,
            "settled fleet archive preserves agents and revokes its controller");
        Equal(FleetQueries.Find(context, fixture.FleetId).Value!.DeliveryEnabled, false, "archived fleet cannot deliver");
        Equal(FleetAuthority.Authenticate(retirement.Fleet, credential).IsSuccess, false, "archived controller credential cannot reconnect");
    }
}
