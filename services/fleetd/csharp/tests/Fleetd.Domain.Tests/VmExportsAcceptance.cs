using System.Reflection;
using System.Text.Json;

namespace Fleetd.Domain.Tests;

internal static class VmExportsAcceptance
{
    internal static void Run(Action<bool, string> check)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Fleetd.VmExportCases")
            ?? throw new InvalidOperationException("Shared VM export cases are missing");
        using var document = JsonDocument.Parse(stream);
        foreach (var sample in document.RootElement.EnumerateArray())
        {
            var mounts = sample.GetProperty("additional").EnumerateArray().Select(value =>
                new VmMount(value.GetProperty("path").GetString()!, value.GetProperty("read_only").GetBoolean())).ToArray();
            var parsed = VmExports.Plan(sample.GetProperty("state").GetString()!, sample.GetProperty("workspace").GetString()!,
                sample.GetProperty("control").GetString()!, sample.GetProperty("protected").EnumerateArray().Select(value => value.GetString()!).ToArray(), mounts);
            check(parsed.IsSuccess == sample.GetProperty("valid").GetBoolean(), "VM export policy: " + sample.GetProperty("name").GetString());
            if (parsed.IsSuccess)
                foreach (var mount in mounts) check(parsed.Value.Contains(mount), "VM export retains exact source and readonly selection");
        }
    }
}
