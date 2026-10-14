using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class DirectoryAcceptance
{
    public static void Verify(CrossfireDbContext context, Actor owner, Actor administrator, long now)
    {
        var fixture = FleetFixture.Create(context, owner, now); var id = fixture.AgentId;
        var reads = AgentReadQueries.Ports(context, () => now);
        var record = AgentReads.Read(reads, owner, id);
        Equal(record.IsSuccess, true, "batched agent details preserve the canonical current binding");
        Equal(record.Value.Deployment.InstanceKey, "test-agent", "agent detail includes exact fleet instance key");
        Equal(record.Value.Activity.Status, "online", "batched activity uses live controller generation");
        Equal(record.Value.CanRetire, false, "a reporting native binding is not advertised as safely retired");
        Equal(record.Value.AllowedActions.Contains("configure"), true, "owner receives configure capability");
        var all = new AgentDirectoryFilter(1, 100, owner.PrincipalId, ["active", "suspended", "revoked"], "", "all", [id]);
        Equal(AgentReads.List(reads, owner, all).Value.Items.Single().Record.Principal.Id, id, "page SQL admits only explicitly selected fleet bindings");
        Equal(AgentReads.List(reads, owner, all with { AgentIds = [] }).Value.TotalItems, 0L, "empty selected roster cannot become an unfiltered query");
        Equal(AgentReads.List(reads, owner, all with { Listener = "online" }).Value.TotalItems, 1L, "online filter uses actual admitted controller lease");
        Equal(AgentReads.List(reads, owner, all with { Listener = "offline" }).Value.TotalItems, 0L, "online native binding is not counted offline");
        Equal(AgentReads.List(reads, owner, all with { OwnerId = administrator.PrincipalId }).Error.Code, "forbidden", "members cannot expand ownership filters");
        Equal(AgentReads.List(reads, administrator, all).Value.TotalItems, 1L, "administrators can request an explicit owner scope");
        Equal(Transactions.Run(context, () =>
        {
            context.Principal.Single(row => row.Id == id).Status = "suspended"; return Results.Done();
        }).IsSuccess, true, "suspended filter fixture");
        Equal(AgentReads.List(reads, owner, all with { Listener = "online" }).Value.TotalItems, 0L, "suspended accounts are not selectable as online");
        Equal(AgentReads.List(reads, owner, all with { Listener = "offline" }).Value.TotalItems, 1L, "suspended accounts remain visible in offline filters");
        Equal(Transactions.Run(context, () => { context.Principal.Single(row => row.Id == id).Status = "active"; return Results.Done(); }).IsSuccess, true, "restore directory fixture status");
        var fleets = FleetReadQueries.Ports(context, () => now); var actor = new FleetPrincipalActor(owner);
        Equal(FleetReads.Read(fleets, actor, fixture.FleetId).Value.Record.Id, fixture.FleetId, "fleet details preserve scoped identity");
        Equal(FleetReads.Agents(fleets, actor, fixture.FleetId, 1, 20).Value.Items.Count, 1, "fleet agent page uses the shared batched agent read owner");
        Equal(FleetReads.Read(fleets, actor, fixture.FleetId).Value.CanArchive, false, "unclosed native history prevents fleet archival");
        var changed = FleetReads.Change(fleets, actor, fixture.FleetId, 0, "Reviewed directory fleet", new("Reviewed controller", new Dictionary<string, string> { ["host"] = "test-host" }), Identity.Identifier());
        Equal(changed.Value.Record.Revision, 1L, "fleet configuration revision advances atomically");
        Equal(changed.Value.Metadata["host"], "test-host", "fleet metadata is read from the canonical relation");
        Equal(FleetReads.Change(fleets, actor, fixture.FleetId, 0, "stale", new("controller", new Dictionary<string, string>()), Identity.Identifier()).Error.Code, "stale_revision", "stale fleet edits fail without deleting metadata");
        Equal(FleetReads.Change(fleets, actor, fixture.FleetId, 1, "Reviewed directory fleet", new("Reviewed controller", new Dictionary<string, string>()), Identity.Identifier()).Value.Metadata.Count, 0, "replaced metadata does not preserve deleted keys");
        Equal(FleetReads.List(fleets, owner, 1, 100, owner.PrincipalId, "reviewed directory").Value.Items.Any(value => value.Record.Id == fixture.FleetId), true, "fleet search is case-insensitive in SQL");
        var disclosure = Discovery.Resolve(DiscoveryQueries.Ports(context, () => now), owner, [record.Value.Record.Principal.MatrixUserId, "@unknown:example.test"]).Value;
        Equal(disclosure[0].OwnerMatrixId, record.Value.Record.Owner.MatrixUserId, "identity discovery includes registered agent owner");
        Equal(disclosure[1].Kind, "unknown", "unregistered names cannot become authority");
    }
}
