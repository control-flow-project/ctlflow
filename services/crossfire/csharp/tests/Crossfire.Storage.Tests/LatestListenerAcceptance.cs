using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class LatestListenerAcceptance
{
    public static void Verify(CrossfireDbContext context, string ownerId)
    {
        var owner = AuthorizationQueries.Principal(context, ownerId).Value!;
        var fixture = FleetFixture.Create(context, new(ownerId, "human", new NativeAuthentication(owner.MatrixUserId)), 1700000000000);
        var original = ListenerQueries.Find(context, fixture.RunId).Value!;
        for (var index = 1; index <= 20; index++)
        {
            var at = original.StartedAt - index;
            Equal(ListenerCommands.Save(context, original with { Id = Identity.Identifier(), StartedAt = at, LastSeenAt = at, StoppedAt = at }, true).IsSuccess, true, "historical listener fixture");
        }
        var prefix = Identity.Identifier()[..^1]; var lower = prefix + "0"; var higher = prefix + "f"; var now = original.StartedAt + 1;
        foreach (var id in new[] { lower, higher })
        {
            Equal(ListenerCommands.Save(context, original with { Id = id, StartedAt = now, LastSeenAt = now, StoppedAt = now }, true).IsSuccess, true, "same-timestamp listener fixture");
            Equal(RuntimeCommands.Observation(context, fixture.AgentId, new(id, "saved-context", null, "codex", id == higher ? "sleeping" : "failed", now, now, true, "shared", 65536, [], null)).IsSuccess, true, "historical runtime fixture");
        }
        Equal(ListenerQueries.Latest(context, [fixture.AgentId, Identity.Identifier()]).Value.Single().Id, higher, "latest run uses the ID tie-break and ignores absent agents");
        Equal(RuntimeQueries.Summary(context, fixture.AgentId).Value!.State, "sleeping", "old failure cannot override the latest runtime");
        Equal(RuntimeQueries.Observations(context, fixture.AgentId).Value.Single().RunId, higher, "runtime detail selects only the latest run");
        Equal(RetirementQueries.Snapshot(context, [fixture.AgentId], [], now).Value.Agents.Single().LatestRun!.Id, higher, "retirement and runtime use the same latest run");
        Equal(ContactQueries.Runs(context).Value.Single(row => row.AgentId == fixture.AgentId).Id, higher, "contact checks use the same latest run");
    }
}
