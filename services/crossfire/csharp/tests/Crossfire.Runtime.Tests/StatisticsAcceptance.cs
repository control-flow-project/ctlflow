using Crossfire.AgentCore;
using Crossfire.Domain;
using Crossfire.Kernel;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public static class StatisticsAcceptance
{
    private static ReceivedEvent Message(string id, string type, long? size = null)
        => new("!room:example.test", new("unknown", null, null), id, "@human:example.test", "message", new(type, "fixture", [], false, false, size is null ? [] : [new("attachment", null, null, size)], WireJson.Object(_ => { })), null, null);
    public static void Verify()
    {
        var collector = new ListenerStatistics("@self:example.test", new ManualTime());
        var labels = new[] { new string('a', 99) + "😀suffix", string.Concat(Enumerable.Repeat("😀", 51)), "", "\n" };
        collector.Record(labels.Select((label, index) => Message("$bounded-" + index, label)).ToArray(), true);
        var sample = new UsageSample("custom-adapter", string.Concat(Enumerable.Repeat("😀", 127)) + "a", new(0, 0, null, 0, null, 0));
        collector.Usage(sample); collector.Usage(sample with { SessionId = string.Concat(Enumerable.Repeat("😀", 128)) }); collector.Usage(sample with { Runtime = "invalid\n" });
        var batch = collector.Batch(true) ?? throw new InvalidOperationException("Missing bounded telemetry");
        Equal(batch.Dropped, 2L, "invalid usage never poisons a telemetry batch");
        Equal(batch.Usage.Count, 1, "usage retains an adapter-neutral valid native session");
        Equal(batch.Usage[0].Runtime, "custom-adapter", "telemetry does not impose a runtime activation whitelist");
        Equal(batch.Flows.Select(flow => flow.MessageType).SequenceEqual(new[] { new string('a', 99), string.Concat(Enumerable.Repeat("😀", 50)), "unknown" }), true, "telemetry truncates at complete Unicode scalar boundaries");
        Equal(batch.Flows.Single(flow => flow.MessageType == "unknown").Totals.Delivered, 2L, "empty and control labels use a bounded valid summary key");
        var bounded = new ListenerStatistics("@self:example.test", new ManualTime());
        bounded.Record([Message("$first", "m.text", 9007199254740991), Message("$second", "m.text", 1)], true);
        var next = bounded.Batch(true) ?? throw new InvalidOperationException("Missing counter summary");
        Equal(next.Dropped, 1L, "overflow drops only the affected sample");
        Equal(next.Flows[0].Totals.Observed, 1L, "overflow cannot partially advance observations");
        Equal(next.Flows[0].Totals.Delivered, 1L, "overflow cannot partially advance deliveries");
        Equal(next.Flows[0].Totals.AttachmentBytes, 9007199254740991L, "the last valid counters remain reportable");
    }
}
