using System.Reflection;
using System.Text.Json;
using Fleetd.Contracts;

namespace Fleetd.Storage.Tests;

internal static class ExecutionAcceptance
{
    internal static void Run(Action<bool, string> check)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Fleetd.ExecutionCases")
            ?? throw new InvalidOperationException("Shared execution cases are missing");
        using var document = JsonDocument.Parse(stream);
        foreach (var sample in document.RootElement.EnumerateArray())
        {
            var name = "Execution case: " + sample.GetProperty("name").GetString();
            var expected = sample.GetProperty("valid").GetBoolean();
            var value = sample.GetProperty("value");
            if (sample.GetProperty("kind").GetString() == "placement")
            {
                var parsed = ExecutionContract.Placement(value);
                check(parsed.IsSuccess == expected, name);
                if (parsed.IsSuccess) check(JsonElement.DeepEquals(ExecutionContract.Placement(parsed.Value), value), name + " retains its exact placement");
                else check(parsed.Error.Code == "invalid", name + " returns invalid input");
            }
            else
            {
                var parsed = ExecutionContract.Catalog(value);
                check(parsed.IsSuccess == expected, name);
                if (parsed.IsSuccess)
                {
                    check(parsed.Value.MemoryBudgetMiB == value.GetProperty("memory_budget_mib").GetInt32(), name + " retains memory units");
                    check(parsed.Value.HostReserveMiB == value.GetProperty("host_reserve_mib").GetInt32(), name + " retains the host reserve");
                    check(parsed.Value.Images.Count == value.GetProperty("images").EnumerateObject().Count(), name + " retains image definitions");
                    check(parsed.Value.Profiles.Count == value.GetProperty("profiles").EnumerateObject().Count(), name + " retains profile definitions");
                }
                else check(parsed.Error.Code == "invalid", name + " returns invalid input");
            }
        }
    }
}
