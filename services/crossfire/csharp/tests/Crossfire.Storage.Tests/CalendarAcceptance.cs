using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterSchedule;
using Crossfire.Domain;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class CalendarAcceptance
{
    public static bool Run(string[] arguments)
    {
        if (arguments.Length == 0 || arguments[0] != "--calendar") return false;
        if (arguments.Length != 2) throw new ArgumentException("Calendar verification requires one bounded corpus");
        using var document = JsonDocument.Parse(PrivateFiles.Read(arguments[1], 8388608));
        var failures = new List<string>(); var failed = 0;
        foreach (var entry in document.RootElement.EnumerateArray())
        {
            var input = entry.GetProperty("schedule"); var after = entry.GetProperty("after").GetInt64();
            WakeSchedule schedule = input.GetProperty("kind").GetString() == "interval" ? new IntervalSchedule(input.GetProperty("seconds").GetInt64())
                : new CronSchedule(input.GetProperty("expression").GetString()!, input.GetProperty("timeZone").GetString()!);
            var expected = entry.GetProperty("expected"); var result = CalendarSchedule.Next(schedule, after);
            var label = input.GetRawText() + " after " + after;
            var matched = expected.ValueKind == JsonValueKind.Null ? !result.IsSuccess : result.IsSuccess && result.Value == expected.GetInt64();
            if (!matched)
            {
                failed++;
                if (failures.Count < 20) failures.Add(label + ": expected " + expected.GetRawText() + ", got " + (result.IsSuccess ? result.Value.ToString() : result.Error.Message));
            }
        }
        Equal(failed, 0, "all calendar cases match; bounded failures: " + string.Join("\n", failures));
        Console.WriteLine("{\"status\":\"passed\",\"assertions\":" + Passed + "}"); return true;
    }
}
