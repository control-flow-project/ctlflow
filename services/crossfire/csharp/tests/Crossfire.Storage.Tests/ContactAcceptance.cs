using Crossfire.AdapterMatrix;
using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Microsoft.EntityFrameworkCore;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class ContactAcceptance
{
    public static void Verify(CrossfireDbContext context, Actor owner, long start)
    {
        var fixture = FleetFixture.Create(context, owner, start); var now = start;
        using var matrix = new AccountAuthority(new("http://127.0.0.1:9", "example.test", "test-jwt", "test-registration", "@crossfire:example.test"));
        var stored = ContactQueries.Ports(context, () => now, matrix.Ports(), "https://example.test", "@crossfire:example.test");
        var ports = stored with { Runs = () => stored.Runs().Map<IReadOnlyList<WatchedRun>>(rows => rows.Where(row => row.AgentId == fixture.AgentId).ToArray()),
            Fleets = () => stored.Fleets().Map<IReadOnlyList<WatchedFleet>>(rows => rows.Where(row => row.Id == fixture.FleetId).ToArray()) };
        Equal(RuntimeContact.Observe(ports).IsSuccess, true, "contact observation needs no native network call");
        Equal(IncidentCommands.Active(context, fixture.AgentId, null).Value.Count, 0, "recent listener is not reported lost");
        now += ControllerAdmission.HeartbeatExpiryMs;
        Equal(RuntimeContact.Observe(ports).IsSuccess, true, "exact heartbeat expiry opens durable contact incident");
        var incident = IncidentCommands.Active(context, fixture.AgentId, null).Value.Single();
        Equal(incident.Kind, "contact", "lost contact is not a native crash diagnosis");
        Equal(incident.Message.Contains("not proof of a crash", StringComparison.Ordinal), true, "owner is told the execution state is unknown");
        Equal(RuntimeContact.Observe(ports).IsSuccess, true, "repeated expiry observation is idempotent");
        Equal(IncidentCommands.Active(context, fixture.AgentId, null).Value.Count, 1, "one incident per contact episode");
        var runId = fixture.RunId;
        context.ListenerRun.Where(row => row.Id == runId).ExecuteUpdate(update => update.SetProperty(row => row.LastSeenAt, now));
        Equal(RuntimeContact.Observe(ports).IsSuccess, true, "fresh heartbeat closes contact incident");
        Equal(IncidentCommands.Find(context, incident.Id).Value!.RecoveredAt, now, "contact restoration records actual observation time");
        Equal(IncidentCommands.Notification(context, incident.Id, "recovery").Value!.EventId is null, true, "contact recovery still needs a confirmed owner notification");
        var fleet = fixture.FleetId;
        context.FleetConnection.Where(row => row.FleetId == fleet).ExecuteUpdate(update => update.SetProperty(row => row.ExpiresAt, now));
        Equal(RuntimeContact.Observe(ports).IsSuccess, true, "controller expiry opens its own contact incident");
        var fleetIncident = IncidentCommands.Active(context, null, fleet).Value.Single();
        Equal(fleetIncident.AgentId is null, true, "fleet failure is not attributed to an arbitrary agent");
        context.FleetConnection.Where(row => row.FleetId == fleet).ExecuteUpdate(update => update.SetProperty(row => row.ExpiresAt, now + 60000));
        Equal(RuntimeContact.Observe(ports).IsSuccess, true, "controller reconnection restores fleet contact");
        Equal(IncidentCommands.Find(context, fleetIncident.Id).Value!.RecoveredAt, now, "fleet recovery is persisted");
        context.ListenerRun.Where(row => row.Id == runId).ExecuteUpdate(update => update.SetProperty(row => row.StoppedAt, now));
        context.FleetConnection.Where(row => row.FleetId == fleet).ExecuteUpdate(update => update.SetProperty(row => row.ClosedAt, now));
        now += 120000;
        Equal(RuntimeContact.Observe(ports).IsSuccess, true, "intentional shutdown is not a lost-contact incident");
        Equal(IncidentCommands.Active(context, fixture.AgentId, null).Value.Count + IncidentCommands.Active(context, null, fleet).Value.Count, 0, "stopped listener and closed controller stay quiet");
    }
}
