using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class EnrollmentFleets
{
    public static Result<FleetRecord> Approve(EnrollmentPorts ports, EnrollmentRequest request)
    {
        if (TextRules.Blank(request.ControllerName) || TextRules.Blank(request.ControllerCredentialHash))
            return Results.Fail<FleetRecord>("invalid", "Fleet enrollment requires a controller");
        var previous = ports.Admission.ByKey(request.OwnerId, request.FleetKey);
        if (!previous.IsSuccess) return Result<FleetRecord>.Fail(previous.Error);
        if (previous.Value is { ArchivedAt: null }) return Result<FleetRecord>.Success(previous.Value);
        var now = ports.Admission.Fleet.Authorization.Now();
        var fleet = previous.Value is null
            ? new FleetRecord(Identity.Identifier(), request.OwnerId, request.FleetKey, request.FleetKey, request.ControllerName, 0, now, now, true, null)
            : previous.Value with { ArchivedAt = null, DeliveryEnabled = true, ControllerName = request.ControllerName, Revision = checked(previous.Value.Revision + 1), UpdatedAt = now };
        var saved = ports.SaveFleet(fleet, previous.Value is null);
        if (!saved.IsSuccess) return Result<FleetRecord>.Fail(saved.Error);
        var metadata = ports.Metadata(request.Id);
        if (!metadata.IsSuccess) return Result<FleetRecord>.Fail(metadata.Error);
        var copied = ports.SaveFleetMetadata(fleet.Id, metadata.Value);
        if (!copied.IsSuccess) return Result<FleetRecord>.Fail(copied.Error);
        return ports.SaveFleetCredential(new(request.Id, fleet.Id, request.ControllerCredentialHash, now, null)).Map(_ => fleet);
    }

    public static Result<Unit> Bind(EnrollmentPorts ports, FleetRecord fleet, IReadOnlyList<EnrollmentItem> entries)
    {
        var existing = ports.Admission.Fleet.Bindings(fleet);
        if (!existing.IsSuccess) return Result<Unit>.Fail(existing.Error);
        var size = existing.Value.Count(value => value.RetiredAt is null);
        var changed = false;
        foreach (var entry in entries)
        {
            if (entry.AgentId is null) return Results.Fail<Unit>("conflict", "Approved roster identity is missing: " + entry.InstanceKey);
            var authoritative = ports.Admission.Fleet.Authorization.Binding(entry.AgentId);
            if (!authoritative.IsSuccess) return Result<Unit>.Fail(authoritative.Error);
            if (authoritative.Value is not null && (authoritative.Value.OwnerId != fleet.OwnerId || authoritative.Value.FleetKey != fleet.FleetKey || authoritative.Value.InstanceKey != entry.InstanceKey))
                return Results.Fail<Unit>("conflict", "Agent already belongs to another fleet instance");
            var previous = ports.Admission.Binding(fleet.OwnerId, fleet.FleetKey, entry.InstanceKey);
            if (!previous.IsSuccess) return Result<Unit>.Fail(previous.Error);
            if (previous.Value is not null && previous.Value.AgentId != entry.AgentId) return Results.Fail<Unit>("conflict", "Fleet instance identity changed: " + entry.InstanceKey);
            if (previous.Value is { RetiredAt: null }) continue;
            if (++size > 100) return Results.Fail<Unit>("capacity", "A fleet supports at most 100 current instances");
            var saved = ports.SaveBinding(new(fleet.OwnerId, fleet.FleetKey, entry.InstanceKey, entry.AgentId, null), previous.Value is null);
            if (!saved.IsSuccess) return saved;
            changed = true;
        }
        return changed ? ports.SaveFleet(fleet with { Revision = checked(fleet.Revision + 1), UpdatedAt = ports.Admission.Fleet.Authorization.Now() }, false) : Results.Done();
    }
}
