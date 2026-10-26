using Crossfire.Server;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class ContainerCommandAcceptance
{
    public static async Task Verify()
    {
        foreach (var arguments in new[] { new[] { "start" }, new[] { "start", "--package", "/removed" }, new[] { "init", "--package", "/removed" } })
        {
            var rejected = false;
            try { await ServerOperator.Run(arguments); }
            catch (ArgumentException) { rejected = true; }
            Equal(rejected, true, "application configuration cannot orchestrate Docker deployment");
        }
    }
}
