using Crossfire.Server.Http;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class FleetChangesAcceptance
{
    public static async Task Verify()
    {
        var changes = new FleetChanges(); var first = "first"; var second = "second";
        var version = changes.Version(first); changes.Notify(first);
        Equal((await changes.Wait(first, version, 10000, CancellationToken.None)).IsSuccess, true, "fleet change between snapshot and wait cannot be lost");
        var pending = changes.Wait(first, changes.Version(first), 10000, CancellationToken.None);
        Equal((await changes.Wait(first, changes.Version(first), 10000, CancellationToken.None)).Error.Code, "conflict", "only one controller long poll per fleet");
        var other = changes.Wait(second, changes.Version(second), 10000, CancellationToken.None);
        changes.Notify(first); Equal((await pending).IsSuccess, true, "fleet-directed mutation releases its controller immediately");
        Equal(other.IsCompleted, false, "an unrelated fleet mutation does not release another controller");
        changes.Notify(); Equal((await other).IsSuccess, true, "agent-scoped changes notify waiting controllers");
        using var cancellation = new CancellationTokenSource();
        var cancelled = changes.Wait(first, changes.Version(first), 10000, cancellation.Token); cancellation.Cancel();
        Equal((await cancelled).Error.Code, "unavailable", "disconnected long polls release their ownership");
        Equal((await changes.Wait(first, changes.Version(first), 0, CancellationToken.None)).IsSuccess, true, "a disconnected controller does not leave a stale poll lock");
    }
}
