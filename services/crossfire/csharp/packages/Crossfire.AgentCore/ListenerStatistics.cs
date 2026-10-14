using System.Text;
using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed class ListenerStatistics(string self, TimeProvider clock)
{
    private readonly object gate = new();
    private readonly Dictionary<(string Room, string Sender, string Type), TrafficFlow> flows = [];
    private readonly Dictionary<(string Runtime, string Session), UsageSample> usage = [];
    private readonly Dictionary<string, (bool Observed, bool Delivered, LinkedListNode<string> Order)> recent = new(StringComparer.Ordinal);
    private readonly LinkedList<string> order = [];
    private long started = clock.GetUtcNow().ToUnixTimeMilliseconds(), sequence, dropped;
    private StatisticsBatch? pending;
    public void Record(IReadOnlyList<ReceivedEvent> events, bool delivered)
    {
        lock (gate) foreach (var value in events)
        {
            if (value.Type != "m.room.message" || value.Sender == self || ReceivedEvents.Notice(value)) continue;
            var previous = recent.GetValueOrDefault(value.EventId); if (delivered ? previous.Delivered : previous.Observed) continue;
            var type = WireJson.Text(value.Content, "msgtype") ?? "unknown"; if (type.Length > 100) type = type[..100];
            var key = (value.RoomId, value.Sender, type); if (!flows.TryGetValue(key, out var flow)) { if (flows.Count >= 256) { dropped++; continue; } flow = new(value.RoomId, value.Sender, type, new()); }
            var bytes = value.ContentFile?.SourceBytes ?? Encoding.UTF8.GetByteCount(WireJson.Compact(value.Content)); long attachment = value.ContentFile?.AttachmentBytes ?? 0;
            if (value.ContentFile is null && value.Content.TryGetProperty("info", out var info) && info.ValueKind == JsonValueKind.Object && info.TryGetProperty("size", out var size)) { var parsed = Validation.Integer(size); if (parsed.IsSuccess) attachment = parsed.Value; }
            var totals = flow.Totals; flows[key] = flow with { Totals = new(checked(totals.Observed + (previous.Observed ? 0 : 1)), checked(totals.Delivered + (delivered ? 1 : 0)), checked(totals.ContentBytes + (previous.Observed ? 0 : bytes)), checked(totals.DeliveredBytes + (delivered ? bytes : 0)), checked(totals.AttachmentBytes + (previous.Observed ? 0 : attachment)), Math.Max(totals.LargestBytes, bytes)) };
            if (previous.Order is not null) order.Remove(previous.Order); recent[value.EventId] = (true, previous.Delivered || delivered, order.AddLast(value.EventId));
            if (recent.Count > 2048) { var first = order.First!; recent.Remove(first.Value); order.RemoveFirst(); }
        }
    }
    public void Usage(UsageSample sample)
    {
        lock (gate)
        {
            var tokens = sample.Tokens; var counts = new long?[] { tokens.Input, tokens.CachedInput, tokens.CacheWriteInput, tokens.Output, tokens.ReasoningOutput, tokens.Total };
            if (sample.Runtime.Length is < 1 or > 100 || sample.SessionId.Length is < 1 or > 255 || counts.Any(value => value is < 0 or > Validation.MaxWireInteger) || tokens.CachedInput > tokens.Input || tokens.CacheWriteInput > tokens.Input || tokens.ReasoningOutput > tokens.Output || !usage.ContainsKey((sample.Runtime, sample.SessionId)) && usage.Count >= 32) { dropped++; return; }
            usage[(sample.Runtime, sample.SessionId)] = sample;
        }
    }
    public StatisticsBatch? Batch(bool force = false)
    {
        lock (gate)
        {
            if (pending is not null) return pending; var ended = Math.Max(started, clock.GetUtcNow().ToUnixTimeMilliseconds());
            if (!force && ended - started < 300000 || flows.Count == 0 && usage.Count == 0 && dropped == 0) return null;
            pending = new(++sequence, started, ended, dropped, flows.Values.ToArray(), usage.Values.ToArray()); flows.Clear(); usage.Clear(); dropped = 0; started = ended; return pending;
        }
    }
    public void Acknowledge(StatisticsBatch? batch) { lock (gate) if (ReferenceEquals(batch, pending)) pending = null; }
}
