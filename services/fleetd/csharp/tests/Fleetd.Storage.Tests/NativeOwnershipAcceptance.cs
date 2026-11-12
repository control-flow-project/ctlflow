using System.Reflection;
using System.Text.Json;
using Fleetd.Storage;

namespace Fleetd.Storage.Tests;

internal static class NativeOwnershipAcceptance
{
    internal static void Run(Action<bool, string> check)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Fleetd.NativeOwnershipCases")
            ?? throw new InvalidOperationException("Shared native ownership cases are missing");
        using var cases = JsonDocument.Parse(stream);
        foreach (var sample in cases.RootElement.EnumerateArray())
        {
            var state = sample.GetProperty("state").GetString()!;
            var expected = Path.Combine(Authentication.Root, "ctlflow", "native-ownership", sample.GetProperty("key").GetString()!);
            check(NativeOwnershipFiles.ForState(state) == expected, "Both targets derive the same host ownership identity");
        }
        foreach (var state in new[] { "relative", "/fleet/../other", "/fleet/./other", "/fleet//other", "/fleet/", "/fleet\\other", "/fleet\0other" })
        {
            var rejected = false;
            try { NativeOwnershipFiles.ForState(state); }
            catch (IOException) { rejected = true; }
            check(rejected, "Ownership derivation rejects a noncanonical state path");
        }
    }
}
