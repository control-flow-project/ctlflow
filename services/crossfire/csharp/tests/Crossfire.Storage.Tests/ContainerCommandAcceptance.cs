using Crossfire.Server;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class ContainerCommandAcceptance
{
    public static async Task Verify()
    {
        var resources = ContainerCommands.Resources("crossfire-test.slice");
        var server = ContainerCommands.Server("/private/example", "fixture-image", "crossfire-example", 8098, 8099, resources);
        var migration = ContainerCommands.Migration("/private/example", "fixture-image", resources);
        Equal(server.Contains("--rm"), false, "server has one explicit lifecycle owner");
        Equal(migration.Contains("--rm"), false, "migration has one explicit lifecycle owner");
        Equal(server.Contains("127.0.0.1:8098:8080") && server.Contains("127.0.0.1:8099:8082"), true, "only explicit loopback ports are exposed");
        Equal(migration.Contains("--network") && migration.Contains("none") && !migration.Contains("--publish"), true, "migration stays network isolated");
        foreach (var option in new[] { "--rm", "--rm=true", "--rm=false" })
        {
            var rejected = false;
            try { await ContainerCommands.Owned(["run", option, "--name", "fixture"], "fixture", "/", CancellationToken.None); }
            catch (ArgumentException) { rejected = true; }
            Equal(rejected, true, "automatic removal is rejected rather than competing with explicit cleanup");
        }
    }
}
