using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class FleetControl
{
    public static Result<FleetControlView> Delivery(FleetPorts ports, FleetActor actor, string fleetId, long expectedRevision, bool enabled, string requestId)
        => ports.Transaction.Run(() =>
        {
            var found = FleetAuthority.Find(ports, actor, fleetId, true);
            if (!found.IsSuccess) return Result<FleetControlView>.Fail(found.Error);
            if (found.Value.Revision != expectedRevision) return Results.Fail<FleetControlView>("stale_revision", "Refresh the fleet before changing delivery");
            var fleet = found.Value with { DeliveryEnabled = enabled, Revision = checked(found.Value.Revision + 1), UpdatedAt = ports.Authorization.Now() };
            var saved = ports.Save(fleet);
            if (!saved.IsSuccess) return Result<FleetControlView>.Fail(saved.Error);
            var audit = ports.Audit(FleetValues.Audit(actor, requestId, fleet, enabled ? "fleet.delivery.activate" : "fleet.delivery.deactivate"));
            if (!audit.IsSuccess) return Result<FleetControlView>.Fail(audit.Error);
            return ports.Connection(fleetId).Map(connection => FleetValues.Control(fleet, connection, ports.Authorization.Now()));
        });

    public static Result<FleetControlView> ReportConnection(FleetPorts ports, FleetActor actor, string fleetId, string connectionId, bool stopped)
    {
        if (actor is not FleetControllerActor controller) return Results.Fail<FleetControlView>("forbidden", "Only this fleet controller can report its connection");
        return ports.Transaction.Run(() =>
        {
            var fleet = FleetAuthority.Find(ports, actor, fleetId);
            if (!fleet.IsSuccess) return Result<FleetControlView>.Fail(fleet.Error);
            var previous = ports.Connection(fleetId);
            if (!previous.IsSuccess) return Result<FleetControlView>.Fail(previous.Error);
            var now = ports.Authorization.Now(); var current = previous.Value;
            if (current is { ClosedAt: null } && current.ConnectionId != connectionId && current.ExpiresAt > now)
                return Results.Fail<FleetControlView>("conflict", "Another live controller owns this fleet connection");
            if (stopped && (current is null || current.ConnectionId != connectionId || current.CredentialId != controller.CredentialId))
                return Results.Fail<FleetControlView>("conflict", "This controller generation does not own the connection");
            if (!stopped && current?.ConnectionId == connectionId && (current.ClosedAt is not null || current.ExpiresAt <= now || current.CredentialId != controller.CredentialId))
                return Results.Fail<FleetControlView>("conflict", "Use a fresh controller connection generation");
            var connection = new FleetConnection(fleetId, connectionId, controller.CredentialId, now, checked(now + FleetValues.ControllerLeaseMs), stopped ? now : null);
            return ports.SaveConnection(connection).Map(_ => FleetValues.Control(fleet.Value, connection, now));
        });
    }
}
