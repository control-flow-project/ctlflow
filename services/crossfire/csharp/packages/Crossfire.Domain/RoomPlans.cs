using System.Globalization;
using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record PlannedGrant(string RoomId, string AccessMode, long? PowerLevel, bool Muted);
public sealed record PlannedAgent(string InstanceKey, IReadOnlyList<PlannedGrant> Grants);
public sealed record RoomPlan(string FleetId, IReadOnlyList<PlannedAgent> Agents);
public sealed record GrantSnapshot(string RoomId, string Generation, long Revision);
public sealed record AgentGrantSnapshot(string AgentId, long Revision, IReadOnlyList<GrantSnapshot> Grants);
public sealed record PlannedChange(GrantProof Proof, string AgentName, string InstanceKey, string RoomName, string? RoomAlias);
public sealed record RoomPlanPreview(string Digest, string FleetId, long FleetRevision, IReadOnlyList<AgentGrantSnapshot> Snapshots, IReadOnlyList<PlannedChange> Changes);

public static class RoomPlans
{
    public static async ValueTask<Result<RoomPlanPreview>> Preview(FleetPorts fleets, RoomGrantPorts grants, MatrixPorts matrix, Actor actor, RoomPlan plan, CancellationToken cancellation = default)
    {
        if (actor.Kind != "human") return Results.Fail<RoomPlanPreview>("forbidden", "Only a human can review a fleet room plan");
        var fleet = FleetAuthority.Find(fleets, new FleetPrincipalActor(actor), plan.FleetId, true); if (!fleet.IsSuccess) return Result<RoomPlanPreview>.Fail(fleet.Error);
        if (plan.Agents.Count is < 1 or > 100 || plan.Agents.Select(value => value.InstanceKey).Distinct(StringComparer.Ordinal).Count() != plan.Agents.Count)
            return Results.Fail<RoomPlanPreview>("invalid", "Choose 1–100 unique fleet instances");
        var bindings = fleets.Bindings(fleet.Value); if (!bindings.IsSuccess) return Result<RoomPlanPreview>.Fail(bindings.Error);
        var changes = new List<PlannedChange>(); var snapshots = new List<AgentGrantSnapshot>();
        var ordering = StringComparer.Create(CultureInfo.GetCultureInfo("en-US"), false);
        foreach (var proposed in plan.Agents.OrderBy(value => value.InstanceKey, ordering))
        {
            if (proposed.Grants.Count > 100 || proposed.Grants.Select(value => value.RoomId).Distinct(StringComparer.Ordinal).Count() != proposed.Grants.Count || proposed.Grants.Any(value => value.AccessMode == "none"))
                return Results.Fail<RoomPlanPreview>("invalid", "A room plan lists up to 100 unique active grants per agent");
            var binding = bindings.Value.SingleOrDefault(value => value.InstanceKey == proposed.InstanceKey);
            if (binding is null) return Results.Fail<RoomPlanPreview>("missing", "Fleet instance is not registered: " + proposed.InstanceKey);
            var target = Authorization.Agent(grants.Authorization, actor, binding.AgentId, "room-grant.manage"); if (!target.IsSuccess) return Result<RoomPlanPreview>.Fail(target.Error);
            var current = grants.Grants(binding.AgentId); if (!current.IsSuccess) return Result<RoomPlanPreview>.Fail(current.Error);
            var conversation = grants.OwnerConversationRoom(binding.AgentId); if (!conversation.IsSuccess) return Result<RoomPlanPreview>.Fail(conversation.Error);
            if (proposed.Grants.Any(value => value.RoomId == conversation.Value)) return Results.Fail<RoomPlanPreview>("invalid", "Owner DMs are built in and must not appear in a room plan");
            snapshots.Add(new(binding.AgentId, target.Value.Principal.Revision, current.Value.Select(value => new GrantSnapshot(value.RoomId, value.Generation, value.Revision)).OrderBy(value => value.RoomId, ordering).ToArray()));
            var rooms = current.Value.Where(value => value.RoomId != conversation.Value).Select(value => value.RoomId).Concat(proposed.Grants.Select(value => value.RoomId)).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal);
            foreach (var roomId in rooms)
            {
                var before = current.Value.SingleOrDefault(value => value.RoomId == roomId); var next = proposed.Grants.SingleOrDefault(value => value.RoomId == roomId);
                var change = new GrantChange(binding.AgentId, roomId, target.Value.Principal.Revision, before?.Generation, next?.AccessMode ?? "none", next?.PowerLevel, next?.Muted ?? false);
                var proof = await RoomGrantAuthorization.Authorize(grants, actor, change, cancellation: cancellation); if (!proof.IsSuccess) return Result<RoomPlanPreview>.Fail(proof.Error);
                var facts = proof.Value.Native;
                var details = facts is null ? await RoomReads.Read(grants, matrix, actor, roomId, binding.AgentId, cancellation) : Result<RoomDetails>.Success(new(roomId, facts.Name, facts.Topic, facts.Alias, facts));
                changes.Add(new(proof.Value, target.Value.Name, proposed.InstanceKey, details.IsSuccess ? details.Value.Name : roomId, details.IsSuccess ? details.Value.Alias : null));
            }
        }
        var rechecked = fleets.Find(plan.FleetId); if (!rechecked.IsSuccess) return Result<RoomPlanPreview>.Fail(rechecked.Error);
        if (rechecked.Value?.Revision != fleet.Value.Revision) return Results.Fail<RoomPlanPreview>("conflict", "Fleet changed during review");
        return Result<RoomPlanPreview>.Success(new(RoomPlanDigest.Digest(plan.FleetId, fleet.Value.Revision, snapshots, changes), plan.FleetId, fleet.Value.Revision, snapshots, changes));
    }

    public static async ValueTask<Result<IReadOnlyList<string>>> Apply(FleetPorts fleets, RoomGrantPorts grants, MatrixPorts matrix, Actor actor, RoomPlan plan, string digest, IReadOnlyList<AgentGrantSnapshot> snapshots, string requestId, CancellationToken cancellation = default)
    {
        var preview = await Preview(fleets, grants, matrix, actor, plan, cancellation); if (!preview.IsSuccess) return Result<IReadOnlyList<string>>.Fail(preview.Error);
        if (preview.Value.Digest != digest || RoomPlanDigest.Snapshots(preview.Value.Snapshots) != RoomPlanDigest.Snapshots(snapshots))
            return Results.Fail<IReadOnlyList<string>>("conflict", "Room plan, native authority or revisions changed; review a new preview");
        return grants.Transaction.Run(() =>
        {
            var fleet = FleetAuthority.Find(fleets, new FleetPrincipalActor(actor), plan.FleetId, true); if (!fleet.IsSuccess) return Result<IReadOnlyList<string>>.Fail(fleet.Error);
            if (fleet.Value.Revision != preview.Value.FleetRevision) return Results.Fail<IReadOnlyList<string>>("conflict", "Fleet changed; review a new preview");
            foreach (var change in preview.Value.Changes)
            { var checkedProof = RoomGrantAuthorization.Recheck(grants, actor, change.Proof); if (!checkedProof.IsSuccess) return Result<IReadOnlyList<string>>.Fail(checkedProof.Error); }
            foreach (var change in preview.Value.Changes)
            { var saved = RoomGrantChanges.Commit(grants, actor, change.Proof, requestId, "room"); if (!saved.IsSuccess) return Result<IReadOnlyList<string>>.Fail(saved.Error); }
            foreach (var snapshot in preview.Value.Snapshots)
            {
                if (!preview.Value.Changes.Any(value => value.Proof.Input.AgentId == snapshot.AgentId && value.Proof.Changed)) continue;
                var target = grants.Authorization.Principal(snapshot.AgentId); if (!target.IsSuccess) return Result<IReadOnlyList<string>>.Fail(target.Error);
                if (target.Value?.Revision != snapshot.Revision) return Results.Fail<IReadOnlyList<string>>("conflict", "Agent revision changed");
                var revised = grants.ReviseAgent(snapshot.AgentId, checked(snapshot.Revision + 1)); if (!revised.IsSuccess) return Result<IReadOnlyList<string>>.Fail(revised.Error);
            }
            return Result<IReadOnlyList<string>>.Success(preview.Value.Snapshots.Select(value => value.AgentId).ToArray());
        });
    }
}
